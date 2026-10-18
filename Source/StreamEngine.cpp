#include "StreamEngine.h"
#include <monocypher.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <map>
#include <arpa/inet.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <pthread.h>
#endif

namespace sharestream {
using Clock = std::chrono::steady_clock;
static double milliseconds() { return std::chrono::duration<double, std::milli>(Clock::now().time_since_epoch()).count(); }
struct StreamEngine::Session {
    Connection config;
    Room room;
    Id peer {};
    double rate = 48000;
    int block = 512;
    AudioRing<> sendQueue, receiveQueue;
    std::atomic<bool> stop {false}, relay {false}, partner {false};
    std::atomic<bool> direct {false};
    std::atomic<double> directRtt {0};
    std::atomic<double> jitterMs {0};
    std::atomic<double> rtt {0}, lastRelay {0};
    std::atomic<uint64_t> packets {0}, lost {0}, underruns {0}, overruns {0}, rejected {0};
    std::atomic<uint64_t> late {0};
    std::atomic<float> inputPeak {0}, outputPeak {0};
    std::thread worker;
    juce::WindowedSincInterpolator receiveL, receiveR;
    bool primed = false;
    float fade = 0;
    double averageFill = 0;
    ~Session() { crypto_wipe(room.key.data(), room.key.size()); }
};
StreamEngine::StreamEngine() = default;
StreamEngine::~StreamEngine() { disconnect(); }
void StreamEngine::setError(const std::string& text) { std::lock_guard lock(errorMutex); error = text; }
bool StreamEngine::connect(const Connection& config) {
    std::lock_guard lock(controlMutex);
    disconnectLocked();
    const auto room = parseRoom(config.code);
    if (!room) { setError("Room code must contain 32 hexadecimal characters."); return false; }
    if (config.host.empty() || config.port < 1 || config.port > 65535) { setError("Enter a server and valid UDP port."); return false; }
    if (hostRate < 8000 || hostRate > 192000) { setError("Use a sample rate between 8 and 192 kHz."); return false; }
    current = std::make_unique<Session>();
    auto& s = *current;
    s.config = config; s.config.jitterMs = std::clamp(config.jitterMs, 5, 100);
    s.jitterMs.store(s.config.jitterMs);
    s.room = *room; s.rate = hostRate; s.block = maxBlock;
    randomBytes(s.peer.data(), s.peer.size());
    setError("");
    s.worker = std::thread([this, ptr=&s] { run(ptr); });
    active.store(&s);
    return true;
}
void StreamEngine::disconnectLocked() {
    active.exchange(nullptr);
    if (current) {
        current->stop.store(true);
        if (current->worker.joinable()) current->worker.join();
        while (audioReaders.load() != 0) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        current.reset();
    }
}
void StreamEngine::disconnect() { std::lock_guard lock(controlMutex); disconnectLocked(); }
void StreamEngine::prepare(double rate, int block) {
    std::lock_guard lock(controlMutex);
    if (current) { disconnectLocked(); setError("Audio device changed. Press Connect again."); }
    hostRate = rate; maxBlock = std::max(1, block);
}
bool StreamEngine::isRunning() const noexcept { return active.load() != nullptr; }
Statistics StreamEngine::statistics() const {
    std::lock_guard lock(controlMutex);
    Statistics out;
    if (auto* s = active.load()) {
        out.running=true; out.relay=s->relay.load(); out.peer=s->partner.load(); out.rttMs=s->rtt.load();
        out.direct=s->direct.load();out.directRttMs=s->directRtt.load();
        out.jitterMs=s->jitterMs.load();
        out.packets=s->packets.load(); out.lost=s->lost.load(); out.underruns=s->underruns.load(); out.overruns=s->overruns.load(); out.rejected=s->rejected.load();
        out.late=s->late.load();
        out.inputPeak=s->inputPeak.load(); out.outputPeak=s->outputPeak.load();
    }
    { std::lock_guard errorLock(errorMutex); out.error=error; }
    return out;
}

void StreamEngine::process(float* const* audio, int numChannels, int numSamples) noexcept {
    audioReaders.fetch_add(1);
    auto* s = active.load();
    if (s == nullptr || numChannels < 1) { audioReaders.fetch_sub(1); return; }
    if (s->config.role == Role::send) {
        float peak = 0;
        for (int offset=0; offset<numSamples; offset+=256) {
            std::array<Stereo, 256> samples {};
            const int n=std::min(256, numSamples-offset);
            for(int i=0; i<n; ++i) {
                float l=audio[0][offset+i], r=audio[numChannels>1 ? 1 : 0][offset+i];
                l=std::isfinite(l) ? l : 0; r=std::isfinite(r) ? r : 0;
                samples[i]={l,r}; peak=std::max({peak,std::abs(l),std::abs(r)});
            }
            if (!s->sendQueue.push(samples.data(), static_cast<size_t>(n))) s->overruns.fetch_add(1);
        }
        s->inputPeak.store(peak);
        // Sender is a transparent insert: only the original local input is sent.
    } else {
        for(int ch=0; ch<numChannels; ++ch) std::fill_n(audio[ch], numSamples, 0.0f);
        const int threshold=std::max(240, static_cast<int>(std::ceil(s->block*48000.0/s->rate))+120);
        size_t fill=s->receiveQueue.available();
        if (!s->primed && fill >= static_cast<size_t>(threshold)) {
            s->primed=true; s->receiveL.reset(); s->receiveR.reset(); s->fade=0; s->averageFill=threshold;
        }
        if (fill > static_cast<size_t>(threshold+2400)) {
            s->receiveQueue.discard(fill-static_cast<size_t>(threshold));
            s->receiveL.reset(); s->receiveR.reset(); s->fade=0; s->overruns.fetch_add(1);
        }
        float peak=0;
        if (s->primed) {
            s->averageFill = s->averageFill*0.99 + static_cast<double>(fill)*0.01;
            const double correction=std::clamp((s->averageFill-threshold)*0.000002, -0.002, 0.002);
            const double ratio=(48000.0/s->rate)*(1.0+correction);
            for(int offset=0; offset<numSamples; offset+=128) {
                const int n=std::min(128, numSamples-offset);
                const size_t needed=static_cast<size_t>(std::ceil(n*ratio))+2;
                std::array<float, 1024> left {}, right {};
                std::array<float, 128> outL {}, outR {};
                if(s->receiveQueue.peek(left.data(),right.data(),needed)<needed) {
                    s->primed=false; s->fade=0; s->underruns.fetch_add(1); break;
                }
                const int used=s->receiveL.process(ratio,left.data(),outL.data(),n);
                s->receiveR.process(ratio,right.data(),outR.data(),n);
                s->receiveQueue.discard(static_cast<size_t>(used));
                for(int i=0; i<n; ++i) {
                    s->fade=std::min(1.0f,s->fade+1.0f/128.0f);
                    const float l=outL[i]*s->fade, r=outR[i]*s->fade;
                    audio[0][offset+i]=numChannels==1 ? (l+r)*0.5f : l;
                    if(numChannels>1) audio[1][offset+i]=r;
                    peak=std::max({peak,std::abs(l),std::abs(r)});
                }
            }
        }
        s->outputPeak.store(peak);
    }
    audioReaders.fetch_sub(1);
}

void StreamEngine::run(Session* s) {
#if defined(__APPLE__)
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE,0);
#endif
    addrinfo hints {}; hints.ai_family=AF_INET; hints.ai_socktype=SOCK_DGRAM;
    addrinfo* address=nullptr;
    const auto port=std::to_string(s->config.port);
    if(getaddrinfo(s->config.host.c_str(),port.c_str(),&hints,&address)!=0) { setError("Cannot resolve server address."); return; }
    const int fd=socket(address->ai_family,SOCK_DGRAM,0);
    if(fd<0) { freeaddrinfo(address); setError("Cannot create UDP socket."); return; }
    // Best-effort EF marking for the time-critical music stream, above screen/voice.
    // Networks may ignore DSCP; failure here must never prevent streaming.
    const int musicTos=46<<2;
    setsockopt(fd,IPPROTO_IP,IP_TOS,&musicTos,sizeof(musicTos));
#if defined(__APPLE__) && defined(SO_NET_SERVICE_TYPE)
    const int musicService=NET_SERVICE_TYPE_VO;
    setsockopt(fd,SOL_SOCKET,SO_NET_SERVICE_TYPE,&musicService,sizeof(musicService));
#endif
    sockaddr_in relayAddress=*reinterpret_cast<sockaddr_in*>(address->ai_addr);
    sockaddr_in local {};local.sin_family=AF_INET;local.sin_addr.s_addr=INADDR_ANY;
    if(bind(fd,reinterpret_cast<const sockaddr*>(&local),sizeof(local))!=0) {close(fd);freeaddrinfo(address);setError("Cannot bind UDP socket.");return;}
    freeaddrinfo(address);
    int bytes=262144; setsockopt(fd,SOL_SOCKET,SO_RCVBUF,&bytes,sizeof(bytes));
    auto sendControl=[&](Kind kind,uint64_t sequence=0) {
        auto wire=control({kind,s->config.role,s->room.id,s->peer,sequence});
        sendto(fd,wire.data(),wire.size(),0,reinterpret_cast<const sockaddr*>(&relayAddress),sizeof(relayAddress));
    };
    juce::WindowedSincInterpolator sendL,sendR;
    const double ratio=s->rate/48000.0;
    uint64_t sendSequence=0,expected=0,highestReceived=0;
    double lastHello=-10000,lastPing=-10000,playAt=0,lastAudio=0,lastDirectProbe=-10000,lastDirectReply=-10000;
    sockaddr_in peerAddress {};Id peerHint {};bool haveEndpoint=false;
    const auto sameAddress=[](const sockaddr_in& a,const sockaddr_in& b){return a.sin_addr.s_addr==b.sin_addr.s_addr && a.sin_port==b.sin_port;};
    bool playing=false,haveStream=false;
    double adaptiveJitter=s->config.jitterMs,averageAhead=adaptiveJitter/2.5;
    Id sender {};
    struct Pending { uint64_t sequence=UINT64_MAX; AudioPacket audio {}; };
    std::array<Pending,256> jitter;
    Stereo lastSample {};
    bool concealed=false;
    while(!s->stop.load()) {
        const double now=milliseconds();
        if(now-lastHello>=1000) { sendControl(Kind::hello); lastHello=now; }
        if(s->relay.load() && now-lastPing>=500) { sendControl(Kind::ping,static_cast<uint64_t>(now*1000)); lastPing=now; }
        if(now-s->lastRelay.load()>3000) { s->relay.store(false); if(!s->direct.load())s->partner.store(false); }
        s->direct.store(s->config.preferDirect && haveEndpoint && now-lastDirectReply<1500);
        if(s->config.preferDirect && haveEndpoint && now-lastDirectProbe>=250) {
            auto probe=encryptProbe({Kind::directPing,s->config.role,s->room.id,s->peer,static_cast<uint64_t>(now*1000)},s->room.key);
            sendto(fd,probe.data(),probe.size(),0,reinterpret_cast<const sockaddr*>(&peerAddress),sizeof(peerAddress));lastDirectProbe=now;
        }
        pollfd poller {fd,POLLIN,0};
        poll(&poller,1,1);
        // Bounded drain prevents a busy socket from starving audio transmission.
        for(int received=0; received<64; ++received) {
            std::array<uint8_t,1200> wire {};
            sockaddr_in source {};socklen_t sourceSize=sizeof(source);
            const auto n=recvfrom(fd,wire.data(),wire.size(),MSG_DONTWAIT,reinterpret_cast<sockaddr*>(&source),&sourceSize);
            if(n<=0) break;
            auto h=readHeader(wire.data(),static_cast<size_t>(n));
            if(!h || h->room!=s->room.id) continue;
            const bool fromRelay=sameAddress(source,relayAddress);
            const bool own=h->peer==s->peer && h->role==s->config.role;
            if(h->kind==Kind::endpoint && fromRelay && own && n==80 && s->config.preferDirect) {
                Id candidate {};std::copy_n(wire.data()+54,16,candidate.begin());
                sockaddr_in endpoint {};endpoint.sin_family=AF_INET;
                std::memcpy(&endpoint.sin_addr.s_addr,wire.data()+48,4);std::memcpy(&endpoint.sin_port,wire.data()+52,2);
                if(endpoint.sin_port && endpoint.sin_addr.s_addr && candidate!=s->peer) {
                    if(!haveEndpoint || peerHint!=candidate || !sameAddress(endpoint,peerAddress))lastDirectReply=-10000;
                    peerAddress=endpoint;peerHint=candidate;haveEndpoint=true;
                }
                continue;
            }
            if((h->kind==Kind::directPing || h->kind==Kind::directPong) && s->config.preferDirect && haveEndpoint && h->peer==peerHint && h->role!=s->config.role) {
                if(!authenticateProbe(wire.data(),static_cast<size_t>(n),s->room.key))continue;
                if(h->kind==Kind::directPing) {
                    auto response=encryptProbe({Kind::directPong,s->config.role,s->room.id,s->peer,h->sequence},s->room.key);
                    sendto(fd,response.data(),response.size(),0,reinterpret_cast<const sockaddr*>(&source),sizeof(source));
                } else {
                    const double rtt=milliseconds()-h->sequence/1000.0;
                    if(rtt>=0 && rtt<1500) {lastDirectReply=milliseconds();peerAddress=source;s->directRtt.store(rtt);s->partner.store(true);}
                }
                continue;
            }
            if(h->kind!=Kind::audio && !fromRelay)continue;
            if(h->kind==Kind::cookie && own && n==controlBytes) {
                wire[4]=static_cast<uint8_t>(Kind::join); sendto(fd,wire.data(),controlBytes,0,reinterpret_cast<const sockaddr*>(&relayAddress),sizeof(relayAddress));
            } else if(h->kind==Kind::ready && own && n==controlBytes) {
                if(wire[48]==2) { setError("This room already has that role. Disconnect the other instance."); s->relay.store(false); }
                else if(wire[48]==3) { setError("Server capacity reached. Try again shortly."); s->relay.store(false); }
                else { s->relay.store(true); s->lastRelay.store(milliseconds()); s->partner.store(wire[49]>0); setError(""); }
            } else if(h->kind==Kind::pong && own && n==controlBytes) {
                s->rtt.store(std::max(0.0,milliseconds()-h->sequence/1000.0)); s->lastRelay.store(milliseconds());
                s->partner.store(wire[49]>0);
            } else if(h->kind==Kind::audio && s->config.role==Role::receive && h->peer!=s->peer) {
                AudioPacket decoded;
                if(!decrypt(wire.data(),static_cast<size_t>(n),s->room.key,decoded)) { s->rejected.fetch_add(1); continue; }
                const double arrived=milliseconds();
                if(!haveStream || sender!=h->peer) {
                    haveStream=true; sender=h->peer; expected=h->sequence; highestReceived=h->sequence; playing=true;
                    playAt=arrived+adaptiveJitter;averageAhead=adaptiveJitter/2.5;
                    for(auto& slot:jitter) slot.sequence=UINT64_MAX;
                    lastSample={}; concealed=false;
                }
                if(h->sequence<expected) {
                    // Only a previously unseen late sequence may grow the buffer.
                    // A duplicate/replay cannot keep increasing the playout delay.
                    if(h->sequence>highestReceived && playing) {
                        const double deadline=playAt-static_cast<double>(expected-h->sequence)*2.5;
                        const double extra=std::clamp(arrived-deadline+5.0,0.0,250.0-adaptiveJitter);
                        adaptiveJitter+=extra;playAt+=extra;s->jitterMs.store(adaptiveJitter);
                    }
                    highestReceived=std::max(highestReceived,h->sequence);
                    s->late.fetch_add(1);continue;
                }
                highestReceived=std::max(highestReceived,h->sequence);
                if(h->sequence-expected>=256) {
                    expected=h->sequence; playAt=arrived+adaptiveJitter; playing=true;
                    for(auto& slot:jitter) slot.sequence=UINT64_MAX;
                }
                auto& slot=jitter[h->sequence%jitter.size()];
                if(slot.sequence==h->sequence) continue;
                slot={h->sequence,decoded}; lastAudio=arrived;
                s->packets.fetch_add(1);
            }
        }
        if(s->config.role==Role::send && (s->relay.load() || s->direct.load())) {
            const int inputCount=static_cast<int>(std::ceil(packetFrames*ratio))+2;
            const size_t maxBacklog=static_cast<size_t>(s->rate*0.05);
            if(s->sendQueue.available()>maxBacklog) {
                s->sendQueue.discard(s->sendQueue.available()-static_cast<size_t>(inputCount));
                sendL.reset(); sendR.reset(); s->overruns.fetch_add(1);
            }
            for(int burst=0;burst<16;++burst) {
                const bool exact=s->rate==48000.0;
                const int need=exact ? packetFrames : inputCount;
                if(s->sendQueue.available()<static_cast<size_t>(need)) break;
                std::array<float,1024> left {},right {};
                std::array<float,packetFrames> outL {},outR {};
                s->sendQueue.peek(left.data(),right.data(),static_cast<size_t>(need));
                int consumed=packetFrames;
                if(exact) { std::copy_n(left.begin(),packetFrames,outL.begin()); std::copy_n(right.begin(),packetFrames,outR.begin()); }
                else { consumed=sendL.process(ratio,left.data(),outL.data(),packetFrames); sendR.process(ratio,right.data(),outR.data(),packetFrames); }
                s->sendQueue.discard(static_cast<size_t>(consumed));
                AudioPacket packet;
                for(int i=0;i<packetFrames;++i) packet[i]={outL[i],outR[i]};
                auto wire=encrypt({Kind::audio,Role::send,s->room.id,s->peer,sendSequence++},s->room.key,packet);
                const auto& destination=s->direct.load() ? peerAddress : relayAddress;
                if(sendto(fd,wire.data(),wire.size(),0,reinterpret_cast<const sockaddr*>(&destination),sizeof(destination))==static_cast<ssize_t>(wire.size())) s->packets.fetch_add(1);
            }
        }
        if(s->config.role==Role::receive && playing) {
            const double time=milliseconds();
            if(time-lastAudio>500 || time-playAt>100) {
                // A stopped host/network cannot leave old sound queued indefinitely.
                playing=false; expected=highestReceived+1;
                for(auto& slot:jitter) slot.sequence=UINT64_MAX;
            } else {
                for(int batch=0;batch<32 && time>=playAt;++batch) {
                    AudioPacket packet {};
                    auto& slot=jitter[expected%jitter.size()];
                    if(slot.sequence==expected) {
                        packet=slot.audio; slot.sequence=UINT64_MAX;
                        if(concealed) for(int i=0;i<packetFrames;++i) { const float f=float(i+1)/packetFrames; packet[i].left*=f; packet[i].right*=f; }
                        lastSample=packet.back(); concealed=false;
                    } else {
                        // Fade a missing frame to zero instead of looping stale audio.
                        for(int i=0;i<packetFrames;++i) { const float f=1.0f-float(i+1)/packetFrames; packet[i]={lastSample.left*f,lastSample.right*f}; }
                        lastSample={}; concealed=true; s->lost.fetch_add(1);
                    }
                    if(!s->receiveQueue.push(packet.data(),packet.size())) s->overruns.fetch_add(1);
                    const double ahead=highestReceived>=expected ? static_cast<double>(highestReceived-expected) : 0.0;
                    averageAhead=averageAhead*0.999+ahead*0.001;
                    const double clockCorrection=std::clamp((averageAhead-adaptiveJitter/2.5)*0.0001,-0.001,0.001);
                    ++expected; playAt+=2.5*(1.0-clockCorrection);
                }
            }
        }
        // Resume a paused sender without accepting packets already played.
        if(s->config.role==Role::receive && haveStream && !playing && milliseconds()-lastAudio<100) {
            playing=true; playAt=milliseconds()+adaptiveJitter;
            // Find the earliest packet retained after the pause.
            uint64_t next=UINT64_MAX;
            for(const auto& slot:jitter) if(slot.sequence>=expected) next=std::min(next,slot.sequence);
            if(next!=UINT64_MAX) expected=next;
        }
    }
    sendControl(Kind::leave); close(fd);
}
}
