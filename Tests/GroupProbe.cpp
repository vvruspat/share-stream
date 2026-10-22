#include "StreamEngine.h"
#include <chrono>
#include <cmath>
#include <iostream>
#include <memory>

int main(int argc,char** argv) {
    using namespace sharestream;
    if(argc!=3)return 2;
    const int port=std::stoi(argv[1]);
    const auto quality=static_cast<AudioQuality>(std::stoi(argv[2]));
    Connection config;config.host="127.0.0.1";config.port=port;config.code=newRoomCode();config.jitterMs=40;config.quality=quality;
    StreamEngine sender;sender.prepare(48000,128);sender.connect(config);
    std::array<std::unique_ptr<StreamEngine>,7> receivers;
    for(auto& receiver:receivers){receiver=std::make_unique<StreamEngine>();receiver->prepare(48000,128);}
    auto join=[&](int i){auto c=config;c.role=Role::receive;c.preferDirect=(i%2==0);return receivers[i]->connect(c);};
    join(0);
    juce::AudioBuffer<float> tx(2,128),rx(2,128);
    std::array<double,7> left{},right{};
    std::array<int,7> samples{};
    bool added=false,leftRoom=false,rejoined=false;
    const auto start=std::chrono::steady_clock::now();
    for(int frame=0;frame<48000*6;frame+=128){
        std::this_thread::sleep_until(start+std::chrono::microseconds(static_cast<int64_t>(frame)*1000000/48000));
        if(frame>=48000 && !added){for(int i=1;i<7;i++)join(i);added=true;}
        if(frame>=48000*2.8 && !leftRoom){receivers[0]->disconnect();leftRoom=true;}
        if(frame>=48000*3.2 && !rejoined){join(0);rejoined=true;}
        for(int i=0;i<128;i++){
            const double time=(frame+i)/48000.0;
            tx.setSample(0,i,static_cast<float>(.15*std::sin(time*997*juce::MathConstants<double>::twoPi)));
            tx.setSample(1,i,static_cast<float>(.1*std::sin(time*1511*juce::MathConstants<double>::twoPi)));
        }
        sender.process(tx.getArrayOfWritePointers(),2,128);
        for(int n=0;n<7;n++){
            rx.clear();receivers[n]->process(rx.getArrayOfWritePointers(),2,128);
            if(frame>=48000*4.5)for(int i=0;i<128;i++){
                left[n]+=std::pow(rx.getSample(0,i),2);right[n]+=std::pow(rx.getSample(1,i),2);++samples[n];
            }
        }
    }
    bool ok=true;
    const auto sent=sender.statistics();
    ok &= sent.peers==7 && sent.directPeers==4 && sent.activeQuality==quality && sent.qualityNegotiated;
    for(int i=0;i<7;i++){
        const auto stats=receivers[i]->statistics();
        const double l=std::sqrt(left[i]/samples[i]),r=std::sqrt(right[i]/samples[i]);
        const bool valid=stats.peer && stats.direct==(i%2==0) && stats.packets>300 && l>.07 && r>.045 && l/r>1.15 && l/r<1.85;
        if(!valid)std::cerr<<"Listener "<<i<<" direct="<<stats.direct<<" packets="<<stats.packets<<" RMS="<<l<<","<<r<<" error="<<stats.error<<'\n';
        ok &= valid;
    }
    sender.disconnect();
    for(auto& receiver:receivers)receiver->disconnect();
    if(ok)std::cout<<"PASS: seven stereo listeners, four direct P2P and three targeted relay paths, late join, rejoin, quality "<<static_cast<int>(quality)<<'\n';
    else std::cerr<<"Sender peers="<<sent.peers<<" direct="<<sent.directPeers<<" quality="<<static_cast<int>(sent.activeQuality)<<'\n';
    return ok?0:1;
}
