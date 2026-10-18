#include "Protocol.h"
#include "AudioRing.h"
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <thread>

static void check(bool value,const char* message) { if(!value) {std::cerr<<"FAIL: "<<message<<'\n';std::exit(1);} }
int main() {
    using namespace sharestream;
    auto code=newRoomCode(); auto room=parseRoom(code);
    check(room.has_value(),"generated room parses");
    check(!parseRoom("test"),"weak room rejected");
    check(!parseRoom(std::string(32,'z')),"invalid hexadecimal rejected");
    check(room->id!=Id{},"routing id derived");
    Id peer {};randomBytes(peer.data(),peer.size());
    Header h {Kind::audio,Role::send,room->id,peer,0x123456789abcdef0ULL};
    AudioPacket original,decoded;
    for(int i=0;i<packetFrames;++i) original[i]={0.2f*std::sin(float(i)*0.1f),-float(i)/packetFrames};
    auto wire=encrypt(h,room->key,original);
    check(readHeader(wire.data(),wire.size())->sequence==h.sequence,"portable sequence encoding");
    check(decrypt(wire.data(),wire.size(),room->key,decoded),"encrypted float32 roundtrip");
    for(int i=0;i<packetFrames;++i) check(original[i].left==decoded[i].left && original[i].right==decoded[i].right,"lossless stereo encoding");
    auto second=encrypt(h,room->key,original);
    check(wire!=second,"unique OS-random nonce");
    for(int offset:{5,8,24,40,48,72,88,1047}) {
        auto tampered=wire;tampered[offset]^=1;
        check(!decrypt(tampered.data(),tampered.size(),room->key,decoded),"header/nonce/tag/audio tampering rejected");
    }
    check(!decrypt(wire.data(),wire.size(),parseRoom(newRoomCode())->key,decoded),"wrong room cannot decrypt");
    check(!decrypt(wire.data(),wire.size()-1,room->key,decoded),"truncated datagram rejected");
    Header probeHeader{Kind::directPing,Role::receive,room->id,peer,123};
    auto probe=encryptProbe(probeHeader,room->key);
    check(authenticateProbe(probe.data(),probe.size(),room->key),"P2P probe authenticated");
    check(!authenticateProbe(probe.data(),probe.size(),parseRoom(newRoomCode())->key),"wrong room cannot open P2P path");
    probe[40]^=1;check(!authenticateProbe(probe.data(),probe.size(),room->key),"P2P probe timestamp authenticated");
    AudioRing<128> ring;
    constexpr int iterations=100000;
    std::thread producer([&]{for(int i=0;i<iterations;++i) {Stereo sample{float(i),-float(i)};while(!ring.push(&sample,1)) std::this_thread::yield();}});
    for(int i=0;i<iterations;++i) {
        float l=0,r=0;while(!ring.peek(&l,&r,1))std::this_thread::yield();
        check(l==float(i) && r==-float(i),"SPSC order and stereo integrity");ring.discard(1);
    }
    producer.join();check(ring.available()==0,"ring fully drained");
    std::cout<<"PASS: authenticated encryption, stereo float32, malformed packets, SPSC concurrency\n";
}
