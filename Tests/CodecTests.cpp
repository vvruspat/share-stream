#include "AudioCodec.h"
#include <juce_core/juce_core.h>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace sharestream;
static void check(bool value,const char* message) {if(!value)throw std::runtime_error(message);}
int main() {
    try {
        AudioCodec codec;
        check(codec.valid(),"Opus initializes on the native architecture");
        const auto room=*parseRoom(newRoomCode());Id peer {};randomBytes(peer.data(),peer.size());
        const Header header{Kind::encodedAudio,Role::send,room.id,peer,42};
        AudioPacket audio {},decoded {};
        for(int i=0;i<packetFrames;++i)audio[i]={0.15f*std::sin(i*0.13f),0.27f*std::cos(i*0.2f)};
        const auto encoded=codec.encode(AudioQuality::pcm24,audio);
        auto wire=encryptFrame(header,room.key,encoded);
        check(wire.size()==812,"24-bit stereo saves 236 bytes per packet without changing the frame duration");
        const auto opened=decryptFrame(wire.data(),wire.size(),room.key);
        check(opened && codec.decode(*opened,decoded),"authenticated PCM24 round trip");
        for(int i=0;i<packetFrames;++i)check(std::abs(audio[i].left-decoded[i].left)<0.000000061f
            && std::abs(audio[i].right-decoded[i].right)<0.000000061f,"24-bit quantization within half a least significant bit");
        for(auto offset:{4,5,8,24,40,48,72,88,91,811}) {
            auto bad=wire;bad[offset]^=1;
            check(!decryptFrame(bad.data(),bad.size(),room.key),"encoded header, format, nonce, tag and samples are authenticated");
        }
        check(!decryptFrame(wire.data(),wire.size(),parseRoom(newRoomCode())->key),"wrong invite cannot decode new qualities");
        check(!decryptFrame(wire.data(),wire.size()-1,room.key),"truncated encoded packet rejected");
        audio[0]={2,-2};audio[1]={std::numeric_limits<float>::quiet_NaN(),std::numeric_limits<float>::infinity()};
        check(codec.decode(codec.encode(AudioQuality::pcm24,audio),decoded),"clip test decodes");
        check(decoded[0].left==8388607.0f/8388608.0f && decoded[0].right==-1 && decoded[1].left==0 && decoded[1].right==0,"PCM24 clips rather than wrapping, and sanitizes nonfinite values");
        check(!codec.validFrame({AudioQuality::pcm24,{0}}),"short PCM24 rejected");
        check(!codec.validFrame({AudioQuality::opus320,{}}),"empty Opus rejected");
        auto caps=encryptCapabilities({Kind::capabilities,Role::receive,room.id,peer,1},room.key);
        check(decryptCapabilities(caps.data(),caps.size(),room.key)==supportedQualities,"quality support is end-to-end authenticated");
        caps[88]^=1;check(!decryptCapabilities(caps.data(),caps.size(),room.key),"tampered capabilities rejected");

        std::vector<Stereo> source,received;
        for(int packet=0;packet<400;++packet) {
            for(int i=0;i<packetFrames;++i) {
                const auto time=double(packet*packetFrames+i)/networkRate;
                audio[i]={float(0.15*std::sin(time*997*juce::MathConstants<double>::twoPi)),float(0.1*std::sin(time*1511*juce::MathConstants<double>::twoPi))};
            }
            source.insert(source.end(),audio.begin(),audio.end());
            auto frame=codec.encode(AudioQuality::opus320,audio);
            check(frame.bytes.size()==100,"Opus CBR is exactly 320 kbps with 2.5 ms frames");
            const auto encrypted=encryptFrame(header,room.key,frame);
            const auto plain=decryptFrame(encrypted.data(),encrypted.size(),room.key);
            check(plain && codec.decode(*plain,decoded),"encrypted Opus320 decodes stereo");
            received.insert(received.end(),decoded.begin(),decoded.end());
        }
        double bestSnr=-1000;
        for(size_t delay=0;delay<=480;++delay) {
            double energy=0,error=0;
            for(size_t i=12000;i<source.size()-480;++i) {
                const auto a=source[i],b=received[i+delay];
                energy+=a.left*a.left+a.right*a.right;
                error+=(a.left-b.left)*(a.left-b.left)+(a.right-b.right)*(a.right-b.right);
            }
            bestSnr=std::max(bestSnr,10*std::log10(energy/std::max(error,1e-20)));
        }
        std::cout<<"Opus stereo SNR "<<bestSnr<<" dB\n";
        check(bestSnr>24,"Opus preserves both independent stereo signals with useful fidelity");
        codec.conceal();codec.resetDecoder();
        std::cout<<"PASS: PCM24 precision/clipping, Opus320 CBR/fidelity, encrypted formats/capabilities and malformed packets\n";
    } catch(const std::exception& error) {std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;}
}
