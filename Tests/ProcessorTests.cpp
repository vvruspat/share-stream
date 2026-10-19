#include "PluginProcessor.h"
#include <chrono>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace sharestream;
static void check(bool okay,const char* message) {if(!okay)throw std::runtime_error(message);}
struct Relay {
    juce::ChildProcess process;
    int port=0;
    Relay() {
        {juce::DatagramSocket socket;check(socket.bindToPort(0,"127.0.0.1"),"reserve relay port");port=socket.getBoundPort();}
        check(process.start(juce::StringArray{SHARE_STREAM_PYTHON,SHARE_STREAM_RELAY_SOURCE,"--host","127.0.0.1","--port",juce::String(port)}),"start isolated relay");
        juce::DatagramSocket probe;check(probe.bindToPort(0,"127.0.0.1"),"relay readiness probe socket");
        const auto room=parseRoom(newRoomCode());Id peer {};randomBytes(peer.data(),peer.size());
        auto hello=control({Kind::hello,Role::send,room->id,peer,0});
        bool ready=false;
        for(int attempt=0;attempt<80 && process.isRunning();++attempt) {
            probe.write("127.0.0.1",port,hello.data(),static_cast<int>(hello.size()));
            if(probe.waitUntilReady(true,100)>0) {
                Control reply {};const auto n=probe.read(reply.data(),static_cast<int>(reply.size()),false);
                auto header=n>0?readHeader(reply.data(),static_cast<size_t>(n)):std::nullopt;
                if(header && header->kind==Kind::cookie && header->peer==peer) {ready=true;break;}
            }
        }
        if(!ready && !process.isRunning())std::cerr<<process.readAllProcessOutput();
        check(ready,"isolated relay answers a real UDP cookie probe before audio tests start");
    }
    ~Relay() {process.kill();}
};
static void receive(StreamEngine& sender,ShareStreamProcessor& receiver,double rate,int block) {
    for(int i=0;i<800 && (!sender.statistics().relay || !receiver.statistics().relay);++i)juce::Thread::sleep(10);
    check(sender.statistics().relay && receiver.statistics().relay,"both audio peers finish relay handshake");
    juce::AudioBuffer<float> tx(2,128),rx(2,block);juce::MidiBuffer midi;
    const auto start=std::chrono::steady_clock::now();
    int audible=0;
    for(int iteration=0;iteration<750;++iteration) {
        std::this_thread::sleep_until(start+std::chrono::microseconds(iteration*8000/3));
        for(int i=0;i<128;++i){tx.setSample(0,i,0.125f);tx.setSample(1,i,-0.25f);}
        sender.process(tx.getArrayOfWritePointers(),2,128);
        rx.clear();receiver.processBlock(rx,midi);
        if(iteration>375 && rx.getMagnitude(0,0,block)>0.05f && rx.getSample(1,block-1)<-0.1f)++audible;
    }
    if(audible<=250) {
        const auto txStats=sender.statistics(),rxStats=receiver.statistics();
        std::cerr<<"Audio diagnostics: audible="<<audible<<" sent="<<txStats.packets<<" received="<<rxStats.packets
                 <<" lost="<<rxStats.lost<<" underruns="<<rxStats.underruns<<" jitter="<<rxStats.jitterMs
                 <<" relay="<<rxStats.relay<<" direct="<<rxStats.direct<<" txError="<<txStats.error<<" rxError="<<rxStats.error<<'\n';
    }
    check(audible>250,"Listen must render received stereo audio with a silent/disabled host input");
    check(receiver.statistics().packets>100,"plugin receives authenticated packets");
    std::cout<<"PASS: Listen at "<<rate<<" Hz, "<<block<<" frames, "<<audible<<" audible steady blocks\n";
}
int main(int argc,char** argv) {
    try {
        juce::ScopedJuceInitialiser_GUI gui;
        ShareStreamProcessor processor;
        check(std::isinf(processor.getTailLengthSeconds()),"network source must not advertise a zero tail");
        auto layout=processor.getBusesLayout();
        layout.inputBuses.set(0,juce::AudioChannelSet::disabled());
        check(processor.setBusesLayout(layout),"output-only Listen layout");
        processor.prepareToPlay(48000,128);
        Relay relay;StreamEngine sender;sender.prepare(48000,128);
        Connection c;c.host="127.0.0.1";c.port=relay.port;c.code=newRoomCode();c.jitterMs=10;
        check(sender.connect(c),"connect synthetic sender");
        c.role=Role::receive;processor.setConfiguration(c);check(processor.start(),"connect plugin Listen");
        receive(sender,processor,48000,128);
        const auto before=processor.statistics().packets;
        processor.prepareToPlay(48000,128);
        check(processor.statistics().packets>=before,"identical prepare preserves live session");
        processor.releaseResources();
        check(processor.statistics().waitingForAudio,"host release retains user connection intent");
        processor.prepareToPlay(48000,128);receive(sender,processor,48000,128);
        processor.prepareToPlay(96000,256);receive(sender,processor,96000,256);
        processor.stop();processor.releaseResources();processor.prepareToPlay(48000,128);
        check(!processor.statistics().running,"explicit Disconnect never auto-reconnects");
        juce::MemoryBlock saved;processor.getStateInformation(saved);
        check(processor.start(),"reconnect before restore");
        processor.setStateInformation(saved.getData(),static_cast<int>(saved.getSize()));
        processor.prepareToPlay(48000,128);
        check(!processor.statistics().running,"session restore still requires explicit Connect");
        sender.disconnect();
        if(argc==3) {
            juce::ChildProcess host;
            check(host.start(juce::StringArray{argv[1],argv[2],"--network",juce::String(relay.port)}),"start actual VST3 host probe");
            check(host.waitForProcessToFinish(30000),"VST3 host probe finishes");
            std::cout<<host.readAllProcessOutput();check(host.getExitCode()==0,"actual plug-in host receives audio");
        }
        std::cout<<"PASS: processor layouts, connection lifecycle, sample-rate change, disconnect and restore\n";
    } catch(const std::exception& error) {std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;}
}
