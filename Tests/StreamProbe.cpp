#include "StreamEngine.h"
#include <chrono>
#include <cmath>
#include <fstream>
#include <iostream>
#include <vector>
#if defined(__APPLE__)
#include <pthread.h>
#endif

static void setAudioPriority() {
#if defined(__APPLE__)
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE,0);
#endif
}

int main(int argc,char** argv) {
    using namespace sharestream;
    std::string host="127.0.0.1", output;
    int port=defaultPort,seconds=5,jitter=10;bool forceRelay=false,remotePeer=false,cycleQuality=false;
    AudioQuality quality=AudioQuality::float32,expectedQuality=AudioQuality::float32;
    std::string explicitRoom;
    double sendRate=48000,receiveRate=48000;
    for(int i=1;i+1<argc;i+=2) {
        std::string arg=argv[i],value=argv[i+1];
        if(arg=="--server")host=value;else if(arg=="--port")port=std::stoi(value);
        else if(arg=="--seconds")seconds=std::stoi(value);else if(arg=="--jitter")jitter=std::stoi(value);
        else if(arg=="--send-rate")sendRate=std::stod(value);else if(arg=="--receive-rate")receiveRate=std::stod(value);
        else if(arg=="--force-relay")forceRelay=value=="1";
        else if(arg=="--remote-peer")remotePeer=value=="1";
        else if(arg=="--quality")quality=static_cast<AudioQuality>(std::stoi(value));
        else if(arg=="--expected-quality")expectedQuality=static_cast<AudioQuality>(std::stoi(value));
        else if(arg=="--cycle-quality")cycleQuality=value=="1";
        else if(arg=="--room")explicitRoom=value;
        else if(arg=="--output")output=value;else {std::cerr<<"Unknown argument: "<<arg<<'\n';return 2;}
    }
    seconds=std::clamp(seconds,3,60);
    if(sendRate<8000 || sendRate>192000 || receiveRate<8000 || receiveRate>192000) return 2;
    StreamEngine sender,receiver;
    sender.prepare(sendRate,128);receiver.prepare(receiveRate,128);
    Connection cfg;cfg.host=host;cfg.port=port;cfg.code=newRoomCode();cfg.jitterMs=jitter;
    if(!explicitRoom.empty())cfg.code=explicitRoom;
    cfg.preferDirect=!forceRelay;
    cfg.quality=quality;
    sender.connect(cfg);cfg.role=Role::receive;if(!remotePeer)receiver.connect(cfg);
    std::this_thread::sleep_for(std::chrono::milliseconds(1300));
    if(!sender.statistics().relay || (!remotePeer && !receiver.statistics().relay)) {
        std::cerr<<"Relay handshake failed: "<<sender.statistics().error<<" / "<<receiver.statistics().error<<'\n';return 1;
    }
    std::vector<Stereo> captured(static_cast<size_t>(seconds*receiveRate));
    std::atomic<unsigned> observedSender{0},observedReceiver{0};
    const auto start=std::chrono::steady_clock::now()+std::chrono::milliseconds(100);
    std::thread tx([&]{
        setAudioPriority();
        juce::AudioBuffer<float> audio(2,128);
        const int total=static_cast<int>(seconds*sendRate);
        int previousPhase=-1;
        for(int frame=0;frame<total;frame+=128) {
            std::this_thread::sleep_until(start+std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(frame/sendRate)));
            int n=std::min(128,total-frame);
            if(cycleQuality) {
                const int phase=std::min(3,static_cast<int>(frame/sendRate/1.5));
                if(phase!=previousPhase) {sender.setQuality(static_cast<AudioQuality>(phase==3?0:phase));previousPhase=phase;}
            }
            for(int i=0;i<n;++i) {
                double time=(frame+i)/sendRate;
                const bool pulse=(frame+i)==static_cast<int>(sendRate);
                audio.setSample(0,i,pulse?0.9f:float(0.15*std::sin(time*997.0*juce::MathConstants<double>::twoPi)));
                audio.setSample(1,i,float(0.1*std::sin(time*1511.0*juce::MathConstants<double>::twoPi)));
            }
            sender.process(audio.getArrayOfWritePointers(),2,n);
            observedSender.fetch_or(1u<<static_cast<int>(sender.statistics().activeQuality));
        }
    });
    std::thread rx([&]{
        setAudioPriority();
        if(remotePeer)return;
        juce::AudioBuffer<float> audio(2,128);
        for(size_t frame=0;frame<captured.size();frame+=128) {
            std::this_thread::sleep_until(start+std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(frame/receiveRate)));
            const int n=static_cast<int>(std::min<size_t>(128,captured.size()-frame));audio.clear();
            receiver.process(audio.getArrayOfWritePointers(),2,n);
            observedReceiver.fetch_or(1u<<static_cast<int>(receiver.statistics().activeQuality));
            for(int i=0;i<n;++i)captured[frame+i]={audio.getSample(0,i),audio.getSample(1,i)};
        }
    });
    tx.join();rx.join();
    auto sent=sender.statistics(),received=receiver.statistics();
    if(remotePeer) {
        std::cout<<"Remote peer path: "<<(sent.direct?"DIRECT P2P":"RELAY")<<" | peer RTT "<<sent.directRttMs<<" ms | packets "<<sent.packets<<'\n';
        sender.disconnect();return sent.direct && sent.packets>100?0:1;
    }
    double energyL=0,energyR=0;size_t n=0,quiet=0;
    for(size_t i=static_cast<size_t>(receiveRate*2);i<captured.size();++i) {
        auto x=captured[i];energyL+=x.left*x.left;energyR+=x.right*x.right;++n;
        if(std::abs(x.left)<0.000001f && std::abs(x.right)<0.000001f)++quiet;
    }
    double rmsL=std::sqrt(energyL/n),rmsR=std::sqrt(energyR/n);
    size_t impulse=0;float max=0;
    for(size_t i=static_cast<size_t>(receiveRate);i<std::min(captured.size(),static_cast<size_t>(receiveRate*1.5));++i)
        if(std::abs(captured[i].left)>max) {max=std::abs(captured[i].left);impulse=i;}
    std::cout<<"Server "<<host<<":"<<port<<" | "<<sendRate<<" -> "<<receiveRate<<" Hz\n"
        <<"Quality "<<qualityName(sent.activeQuality)<<" -> "<<qualityName(received.activeQuality)<<" | observed "<<observedSender.load()<<" / "<<observedReceiver.load()<<'\n'
        <<"Path: "<<(sent.direct?"DIRECT P2P":"RELAY FALLBACK")<<" | peer RTT "<<received.directRttMs<<" ms\n"
        <<"Adaptive network buffer "<<received.jitterMs<<" ms\n"
        <<"Relay RTT "<<received.rttMs<<" ms | pulse peak "<<max<<" | synthetic one-way pulse "<<(max>0.3f ? (impulse/receiveRate-1)*1000 : -1)<<" ms (-1 = pulse lost; no hardware)\n"
        <<"Sent "<<sent.packets<<" | received "<<received.packets<<" | lost "<<received.lost<<" | late "<<received.late<<" | underruns "<<received.underruns<<" | source overruns "<<sent.overruns<<" | overruns "<<received.overruns<<" | rejected "<<received.rejected<<'\n'
        <<"RMS L "<<rmsL<<" R "<<rmsR<<" | silent samples "<<quiet<<"/"<<n<<'\n';
    if(!output.empty()) {
        std::ofstream f(output,std::ios::binary);
        uint32_t dataBytes=static_cast<uint32_t>(captured.size()*8),riffSize=dataBytes+36,fmtSize=16,rate=static_cast<uint32_t>(receiveRate),byteRate=rate*8;
        uint16_t format=3,ch=2,align=8,bits=32;
        f.write("RIFF",4);f.write(reinterpret_cast<char*>(&riffSize),4);f.write("WAVEfmt ",8);f.write(reinterpret_cast<char*>(&fmtSize),4);
        f.write(reinterpret_cast<char*>(&format),2);f.write(reinterpret_cast<char*>(&ch),2);f.write(reinterpret_cast<char*>(&rate),4);f.write(reinterpret_cast<char*>(&byteRate),4);
        f.write(reinterpret_cast<char*>(&align),2);f.write(reinterpret_cast<char*>(&bits),2);f.write("data",4);f.write(reinterpret_cast<char*>(&dataBytes),4);
        f.write(reinterpret_cast<const char*>(captured.data()),dataBytes);
    }
    sender.disconnect();
    std::this_thread::sleep_for(std::chrono::milliseconds(800));
    juce::AudioBuffer<float> silence(2,128);float residual=0;
    for(int i=0;i<500;++i) {silence.clear();receiver.process(silence.getArrayOfWritePointers(),2,128);residual=std::max(residual,silence.getMagnitude(0,128));}
    receiver.disconnect();
    const bool qualityGood=cycleQuality ? observedSender.load()==7 && observedReceiver.load()==7
        : sent.activeQuality==expectedQuality && received.activeQuality==expectedQuality;
    const bool good=qualityGood && rmsL>0.08 && rmsL<0.13 && rmsR>0.05 && rmsR<0.09 && quiet<n/100 && residual<0.0001f;
    std::cout<<(good?"PASS":"FAIL")<<": stereo stream and silence after sender stops\n";
    return good?0:1;
}
