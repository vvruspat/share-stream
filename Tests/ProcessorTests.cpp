#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "Invitation.h"
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
        const auto room=parseRoom(newRoomCode());Id peer {};randomBytes(peer.data(),peer.size());
        auto hello=control({Kind::hello,Role::send,room->id,peer,0});
        bool ready=false;
        for(int attempt=0;attempt<80 && process.isRunning();++attempt) {
            juce::DatagramSocket probe;check(probe.bindToPort(0,"127.0.0.1"),"relay readiness probe socket");
            probe.write("127.0.0.1",port,hello.data(),static_cast<int>(hello.size()));
            if(probe.waitUntilReady(true,100)>0) {
                Control reply {};juce::String address;int sourcePort=0;
                const auto n=probe.read(reply.data(),static_cast<int>(reply.size()),false,address,sourcePort);
                auto header=n>0?readHeader(reply.data(),static_cast<size_t>(n)):std::nullopt;
                if(header && header->kind==Kind::cookie && header->peer==peer) {ready=true;break;}
            }
            juce::Thread::sleep(50); // ICMP errors can make readiness return immediately on Windows.
        }
        if(!ready) {process.kill();process.waitForProcessToFinish(2000);std::cerr<<process.readAllProcessOutput();}
        check(ready,"isolated relay answers a real UDP cookie probe before audio tests start");
    }
    ~Relay() {process.kill();}
};
static void receive(StreamEngine& sender,ShareStreamProcessor& receiver,double rate,int block,float gain=1) {
    for(int i=0;i<800 && (!sender.statistics().relay || !receiver.statistics().relay);++i)juce::Thread::sleep(10);
    if(!sender.statistics().relay || !receiver.statistics().relay)std::cerr<<"Handshake diagnostics: "<<sender.statistics().error<<" / "<<receiver.statistics().error<<'\n';
    check(sender.statistics().relay && receiver.statistics().relay,"both audio peers finish relay handshake");
    juce::AudioBuffer<float> tx(2,128),rx(2,block);juce::MidiBuffer midi;
    const auto start=std::chrono::steady_clock::now();
    int audible=0;
    for(int iteration=0;iteration<750;++iteration) {
        std::this_thread::sleep_until(start+std::chrono::microseconds(iteration*8000/3));
        for(int i=0;i<128;++i){tx.setSample(0,i,0.125f);tx.setSample(1,i,-0.25f);}
        sender.process(tx.getArrayOfWritePointers(),2,128);
        rx.clear();receiver.processBlock(rx,midi);
        if(iteration>375 && std::abs(rx.getSample(0,block-1)-.125f*gain)<.02f*gain
            && std::abs(rx.getSample(1,block-1)+.25f*gain)<.03f*gain)++audible;
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
static void setGain(ShareStreamProcessor& processor,const char* id,float db) {
    auto* value=processor.parameters.getParameter(id);
    value->setValueNotifyingHost(value->convertTo0to1(db));
}
static void monitoring(Relay& relay) {
    ShareStreamProcessor sender;StreamEngine receiver;
    sender.prepareToPlay(48000,128);receiver.prepare(48000,128);
    Connection c;c.host="127.0.0.1";c.port=relay.port;c.code=newRoomCode();c.jitterMs=10;
    sender.setConfiguration(c);check(sender.start(),"connect processor sender for independent monitoring test");
    c.role=Role::receive;check(receiver.connect(c),"connect monitoring test receiver");
    for(int i=0;i<800 && (!sender.statistics().peer || !receiver.statistics().peer);++i)juce::Thread::sleep(10);
    check(sender.statistics().peer && receiver.statistics().peer,"both sides report partner presence");
    juce::AudioBuffer<float> tx(2,128),rx(2,128);juce::MidiBuffer midi;
    int localMuted=0,remoteAudible=0;
    auto start=std::chrono::steady_clock::now();
    for(int iteration=0;iteration<750;++iteration) {
        std::this_thread::sleep_until(start+std::chrono::microseconds(iteration*8000/3));
        if(iteration==375)setGain(sender,"sendMonitorDb",-60);
        for(int i=0;i<128;++i){tx.setSample(0,i,.125f);tx.setSample(1,i,-.25f);}
        sender.processBlock(tx,midi);rx.clear();receiver.process(rx.getArrayOfWritePointers(),2,128);
        if(iteration>450) {
            if(tx.getMagnitude(0,128)==0)++localMuted;
            if(rx.getMagnitude(0,0,128)>.1f && rx.getSample(1,127)<-.2f)++remoteAudible;
        }
    }
    check(localMuted>250 && remoteAudible>250,"muted Send monitoring leaves the authenticated remote stream at its original level");
    sender.stop();
    for(int i=0;i<800 && receiver.statistics().peer;++i)juce::Thread::sleep(10);
    check(!receiver.statistics().peer,"listener detects sender departure without disconnecting itself");
    receiver.disconnect();
    setGain(sender,"sendMonitorDb",-6);setGain(sender,"listenMonitorDb",-12);
    c=sender.configuration();c.quality=AudioQuality::pcm24;sender.setConfiguration(c);
    juce::MemoryBlock state;sender.getStateInformation(state);
    ShareStreamProcessor restored;restored.setStateInformation(state.getData(),static_cast<int>(state.getSize()));
    check(std::abs(restored.parameters.getRawParameterValue("sendMonitorDb")->load()+6)<.01f
        && std::abs(restored.parameters.getRawParameterValue("listenMonitorDb")->load()+12)<.01f
        && restored.configuration().quality==AudioQuality::pcm24,"independent monitoring and stream quality persist in DAW state");
    restored.prepareToPlay(48000,128);
    for(int i=0;i<128;++i){tx.setSample(0,i,.125f);tx.setSample(1,i,-.25f);}
    restored.processBlock(tx,midi);
    check(std::abs(tx.getSample(0,127)-.125f*juce::Decibels::decibelsToGain(-6.0f))<1e-6f,"restored Send monitoring gain applies while disconnected");
    std::cout<<"PASS: independent local monitoring, mute, unity remote level, departure and persisted settings\n";
}
static void invitationActions(Relay& relay) {
    ShareStreamProcessor processor;processor.prepareToPlay(48000,128);
    auto c=processor.configuration();c.host="127.0.0.1";c.port=relay.port;processor.setConfiguration(c);
    const auto previousClipboard=juce::SystemClipboard::getTextFromClipboard();
    struct RestoreClipboard {juce::String value;~RestoreClipboard(){juce::SystemClipboard::copyTextToClipboard(value);}} restore{previousClipboard};
    std::unique_ptr<juce::AudioProcessorEditor> editor(processor.createEditor());
    auto click=[&](const juce::String& title) {
        for(auto* child:editor->getChildren())if(auto* button=dynamic_cast<juce::TextButton*>(child))
            if(button->getButtonText()==title) {check(button->isEnabled(),"live role/invite action remains enabled");button->onClick();return;}
        check(false,"public editor button exists");
    };
    click("Copy invite");
    check(processor.statistics().running,"Copy invite starts the current room without a second Connect click");
    check(parseInvitation(juce::SystemClipboard::getTextFromClipboard().toStdString())->code==c.code,"copied invitation preserves the unified room token");
    click("Listen");
    check(processor.statistics().running && processor.configuration().role==Role::receive && processor.configuration().code==c.code,"live role change reconnects in the same room");
    click("Send");
    check(processor.statistics().running && processor.configuration().role==Role::send,"reverse role change does not require manual Disconnect/Connect");
    const auto secondRoom=newRoomCode();
    juce::SystemClipboard::copyTextToClipboard(invitationLink({secondRoom,RelayAddress{"127.0.0.1",relay.port}}));
    click("Paste invite");
    check(processor.statistics().running && processor.configuration().code==secondRoom,"Paste invite switches the room and connects in one action");
    juce::SystemClipboard::copyTextToClipboard("invalid invite");click("Paste invite");
    check(processor.statistics().running && processor.configuration().code==secondRoom,"invalid paste does not stop a live session");
    processor.stop();
    std::cout<<"PASS: public Copy/Paste actions auto-connect, live roles preserve room, malformed invite leaves session intact\n";
}
int main(int argc,char** argv) {
    try {
        juce::ScopedJuceInitialiser_GUI gui;
        if(argc==3 && std::string(argv[1])=="--snapshot") {
            ShareStreamProcessor preview;
            std::unique_ptr<juce::AudioProcessorEditor> editor(preview.createEditor());
            auto image=editor->createComponentSnapshot(editor->getLocalBounds());
            juce::FileOutputStream output{juce::File(argv[2])};
            check(output.openedOk(),"open editor preview image");
            check(juce::PNGImageFormat().writeImageToStream(image,output),"write editor preview image");
            return 0;
        }
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
        setGain(processor,"listenMonitorDb",-6);
        receive(sender,processor,96000,256,juce::Decibels::decibelsToGain(-6.0f));
        processor.stop();processor.releaseResources();processor.prepareToPlay(48000,128);
        check(!processor.statistics().running,"explicit Disconnect never auto-reconnects");
        juce::MemoryBlock saved;processor.getStateInformation(saved);
        check(processor.start(),"reconnect before restore");
        processor.setStateInformation(saved.getData(),static_cast<int>(saved.getSize()));
        processor.prepareToPlay(48000,128);
        check(!processor.statistics().running,"session restore still requires explicit Connect");
        sender.disconnect();
        monitoring(relay);
        invitationActions(relay);
        if(argc==3) {
            juce::ChildProcess host;
            check(host.start(juce::StringArray{argv[1],argv[2],"--network",juce::String(relay.port)}),"start actual VST3 host probe");
            check(host.waitForProcessToFinish(30000),"VST3 host probe finishes");
            std::cout<<host.readAllProcessOutput();check(host.getExitCode()==0,"actual plug-in host receives audio");
        }
        std::cout<<"PASS: processor layouts, connection lifecycle, sample-rate change, disconnect and restore\n";
    } catch(const std::exception& error) {std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;}
}
