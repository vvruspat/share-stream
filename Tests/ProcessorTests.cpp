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
static juce::Component* control(juce::Component& parent,const juce::String& id) {
    if(parent.getComponentID()==id)return &parent;
    for(auto* child:parent.getChildren())if(auto* found=control(*child,id))return found;
    return nullptr;
}
static void monitorControls() {
    ShareStreamProcessor processor;processor.prepareToPlay(48000,128);
    std::unique_ptr<juce::AudioProcessorEditor> editor(processor.createEditor());
    auto* slider=dynamic_cast<juce::Slider*>(control(*editor,"local-monitor"));
    auto* send=dynamic_cast<juce::TextButton*>(control(*editor,"send-role"));
    auto* listen=dynamic_cast<juce::TextButton*>(control(*editor,"listen-role"));
    check(slider && send && listen,"native local-monitor and role controls exist");
    const auto fixture=juce::JSON::parse(juce::File(SHARE_STREAM_MONITOR_FIXTURES));
    check(fixture.isObject() && fixture["cases"].isArray(),"shared native/browser monitoring fixture loads");
    check(slider->getMinimum()==static_cast<double>(fixture["min"]) && slider->getMaximum()==static_cast<double>(fixture["max"])
        && std::abs(slider->getInterval()-static_cast<double>(fixture["step"]))<1e-6
        && std::abs(slider->getValue()-static_cast<double>(fixture["default"]))<1e-4,"native and browser use the same monitor range, step and unity default");
    juce::AudioBuffer<float> audio(2,128);juce::MidiBuffer midi;
    for(const auto& test:*fixture["cases"].getArray()) {
        slider->setValue(static_cast<double>(test["db"]),juce::sendNotificationSync);
        for(int block=0;block<20;++block) {
            for(int n=0;n<128;++n){audio.setSample(0,n,.125f);audio.setSample(1,n,-.25f);}
            processor.processBlock(audio,midi);
        }
        const auto expected=static_cast<float>(test["gain"]);
        check(std::abs(audio.getSample(0,127)-.125f*expected)<1e-6f && std::abs(audio.getSample(1,127)+.25f*expected)<1e-6f,"native fader changes actual stereo output samples, including mute and +6 dB");
        const auto peaks=processor.monitorPeaks();
        check(std::abs(peaks[0]-.125f*expected)<1e-6f && std::abs(peaks[1]-.25f*expected)<1e-6f,"native meter follows the actual post-fader stereo samples");
    }
    slider->setValue(-6,juce::sendNotificationSync);
    listen->onClick();check(std::abs(slider->getValue())<.001,"Listen has an independent unity default");
    slider->setValue(-20,juce::sendNotificationSync);
    send->onClick();check(std::abs(slider->getValue()+6)<.001,"Send restores its own fader value");
    listen->onClick();check(std::abs(slider->getValue()+20)<.001,"Listen restores its own fader value");
    const auto now=juce::Time::getCurrentTime();
    slider->mouseDoubleClick(juce::MouseEvent(juce::Desktop::getInstance().getMainMouseSource(),{},juce::ModifierKeys::leftButtonModifier,1,0,0,0,0,slider,slider,now,{},now,2,false));
    check(std::abs(processor.parameters.getRawParameterValue("listenMonitorDb")->load())<.001f
        && std::abs(processor.parameters.getRawParameterValue("sendMonitorDb")->load()+6)<.001f,"double-click resets only the selected monitor to 0 dB");
    std::cout<<"PASS: native monitor UI changes real samples at shared dB gains, stereo metering, independent roles and double-click unity\n";
}
static void monitorMeter() {
    ShareStreamProcessor processor;processor.prepareToPlay(48000,128);
    check(processor.configuration().host==defaultRelayHost,"new processors connect through the relay domain");
    juce::XmlElement legacy("ShareStream");legacy.setAttribute("server","13.140.153.191");legacy.setAttribute("room",newRoomCode());
    juce::MemoryBlock legacyState;juce::AudioProcessor::copyXmlToBinary(legacy,legacyState);
    processor.setStateInformation(legacyState.getData(),static_cast<int>(legacyState.getSize()));
    check(processor.configuration().host==defaultRelayHost,"saved projects migrate the former built-in relay IP to the domain");
    auto custom=processor.configuration();custom.host="192.0.2.10";processor.setConfiguration(custom);
    check(processor.configuration().host==custom.host,"custom relay addresses are preserved");
    custom.host=defaultRelayHost;processor.setConfiguration(custom);
    juce::AudioBuffer<float> audio(2,128);juce::MidiBuffer midi;
    auto render=[&](float left,float right) {
        for(int block=0;block<20;++block) {
            for(int n=0;n<128;++n){audio.setSample(0,n,left);audio.setSample(1,n,right);}
            processor.processBlock(audio,midi);
        }
        return processor.monitorPeaks();
    };
    auto levels=render(.25f,-.5f);
    check(std::abs(levels[0]-.25f)<1e-6f && std::abs(levels[1]-.5f)<1e-6f,"real L/R meter channels remain independent at unity");
    setGain(processor,"sendMonitorDb",-6);levels=render(.25f,-.5f);
    const auto gain=juce::Decibels::decibelsToGain(-6.0f);
    check(std::abs(levels[0]-.25f*gain)<1e-6f && std::abs(levels[1]-.5f*gain)<1e-6f,"meter measures the post-gain local output");
    levels=render(0,0);
    check(levels[0]==0 && levels[1]==0 && std::abs(processor.parameters.getRawParameterValue("sendMonitorDb")->load()+6)<.001f,"silence clears signal bars without moving gain");
    render(.25f,-.5f);processor.releaseResources();levels=processor.monitorPeaks();
    check(levels[0]==0 && levels[1]==0,"stopped audio cannot leave stale meter telemetry");
    const auto id=processor.participantId();const auto browserURL=processor.collaborationURL();
    const auto privateLink=browserURL.toString(true);
    check(privateLink.contains("#room=") && privateLink.contains("&join=1&participant="),"the exact browser launch URL preserves fragment separators and auto-join intent");
    const auto invite=parseInvitation(privateLink.toStdString());
    check(invite.has_value() && privateLink.contains("&participant="),"Voice & screen binds this participant to the existing room");
    check(!juce::String(invitationLink(*invite)).contains("participant="),"shared invitations never copy the private participant binding");
    juce::MemoryBlock state;processor.getStateInformation(state);ShareStreamProcessor restored;restored.setStateInformation(state.getData(),static_cast<int>(state.getSize()));
    check(restored.participantId()==id,"participant identity survives DAW session restoration");
    std::cout<<"PASS: relay domain/migration, real stereo post-monitor meter, silence, stopped audio and private browser/plugin identity\n";
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
        std::function<juce::TextButton*(juce::Component*)> find=[&](juce::Component* parent)->juce::TextButton* {
            for(auto* child:parent->getChildren()){if(auto* button=dynamic_cast<juce::TextButton*>(child))if(button->getButtonText()==title)return button;if(auto* result=find(child))return result;}return nullptr;
        };
        if(auto* button=find(editor.get()))
            if(button->getButtonText()==title) {check(button->isEnabled(),"live role/invite action remains enabled");button->onClick();return;}
        check(false,"public editor button exists");
    };
    click("Create session");
    check(processor.statistics().running,"Create session opens the music session");
    click("Copy invite");
    check(processor.statistics().running,"Copy invite starts the current room without a second Connect click");
    check(parseInvitation(juce::SystemClipboard::getTextFromClipboard().toStdString())->code==c.code,"copied invitation preserves the unified room token");
    click("Listen");
    check(processor.statistics().running && processor.configuration().role==Role::receive && processor.configuration().code==c.code,"live role change reconnects in the same room");
    click("Send audio");
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
        if(argc==4 && std::string(argv[1])=="--directory-probe") {
            auto body=[](std::initializer_list<std::pair<juce::String,juce::var>> fields){auto* object=new juce::DynamicObject;for(const auto& field:fields)object->setProperty(field.first,field.second);return juce::var(object);};
            const auto password=juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_TEST_PASSWORD",{});
            juce::String code;
            auto wait=[&](auto&& predicate){for(int i=0;i<240;++i){if(predicate())return;juce::Thread::sleep(50);}throw std::runtime_error("Directory probe timed out");};
            {
                RoomDirectory directory;
                directory.request("/api/accounts/login",body({{"username",juce::String(argv[2])},{"password",password}}));
                wait([&]{return !directory.state().busy && directory.state().user["username"].toString()==argv[2];});
                code=newRoomCode();
                directory.request("/api/rooms",body({{"code",code},{"name","Native room"}}));
                wait([&]{return !directory.state().busy && directory.state().selected.isObject();});
                auto saved=directory.state().selected;const auto id=saved["id"].toString();
                check(saved["code"].toString()==code && static_cast<bool>(saved["owner"]),"native client creates a persistent room");
                const auto participant=directory.participant(code);check(participant.length()==32,"native room has an account-bound credential");
                directory.request("/api/rooms/"+id,body({{"name","Native renamed"}}),"PATCH");
                wait([&]{const auto state=directory.state();return !state.busy && state.rooms.isArray() && (*state.rooms.getArray())[0]["name"].toString()=="Native renamed";});
                directory.request("/api/rooms/"+id+"/invitations",body({{"username",juce::String(argv[3])}}));
                wait([&]{const auto state=directory.state();return !state.busy && state.rooms.isArray() && (*state.rooms.getArray())[0]["members"].size()==2;});
                directory.request("/api/accounts/login",body({{"username",juce::String(argv[3])},{"password",password}}));
                wait([&]{return !directory.state().busy && directory.state().user["username"].toString()==argv[3];});
                check(directory.participant(code).isNotEmpty() && directory.participant(code)!=participant,"different accounts have separate room identities");
                directory.select(1);
                wait([&]{return !directory.state().busy && directory.state().user["username"].toString()==argv[2];});
                check(directory.participant(code)==participant,"switching back restores the original room identity");
            }
            {
                ShareStreamProcessor processor;
                wait([&]{return processor.directory.state().rooms.size()==1;});
                auto config=processor.configuration();config.code=code.toStdString();processor.setConfiguration(config);
                check(!processor.statistics().running,"restoring a saved account never starts streaming");
                std::unique_ptr<juce::AudioProcessorEditor> editor(processor.createEditor());
                auto image=editor->createComponentSnapshot(editor->getLocalBounds());
                const auto target=juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_TEST_SNAPSHOT",{});
                if(target.isNotEmpty()){juce::FileOutputStream output{juce::File(target)};check(juce::PNGImageFormat().writeImageToStream(image,output),"write directory preview");}
                const juce::String unsaved=newRoomCode();
                std::function<void(juce::Component*)> configure=[&](juce::Component* parent){
                    for(auto* child:parent->getChildren()){
                        if(auto* field=dynamic_cast<juce::TextEditor*>(child)){
                            if(field->getTitle()=="Relay server")field->setText("127.0.0.1");
                            if(field->getTitle()=="UDP port")field->setText("48190");
                            if(field->getTitle()=="Private session code")field->setText(unsaved);
                        }
                        configure(child);
                    }
                };
                configure(editor.get());
                std::function<juce::TextButton*(juce::Component*)> findConnect=[&](juce::Component* parent)->juce::TextButton* {
                    for(auto* child:parent->getChildren()){if(auto* button=dynamic_cast<juce::TextButton*>(child))if(button->getButtonText()=="Connect to room")return button;if(auto* found=findConnect(child))return found;}return nullptr;
                };
                auto* connect=findConnect(editor.get());check(connect!=nullptr,"saved room exposes the public Connect action");connect->onClick();
                wait([&]{return !processor.directory.state().busy && processor.directory.state().rooms.size()==2;});
                check(processor.directory.participant(unsaved).isNotEmpty(),"native Create/Connect action saves a previously unknown room for the signed-in account");
                processor.stop();
                juce::MemoryBlock projectState;processor.getStateInformation(projectState);
                const std::string xml(static_cast<const char*>(projectState.getData()),projectState.getSize());
                check(xml.find(password.toStdString())==std::string::npos && xml.find(processor.directory.participant(unsaved).toStdString())==std::string::npos,"DAW state contains neither account password nor participant credential");
                processor.directory.request("/api/accounts/logout");
                wait([&]{return !processor.directory.state().busy && !processor.directory.state().user.isObject();});
                check(processor.directory.state().accounts.size()==1,"sign out forgets just the selected account");
            }
            check(!juce::File(juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_ACCOUNT_FILE",{})).loadFileAsString().contains(password),"native settings never contain the password");
            std::cout<<"PASS: native login, room creation, rename, invitations, account switching, restore and logout\n";return 0;
        }
        if(argc==4 && std::string(argv[1])=="--presence-probe") {
            const juce::String roomLabel="ShareStream-call-room-v1:"+juce::String(argv[2]);
            auto* value=new juce::DynamicObject;
            value->setProperty("room",juce::SHA256(roomLabel.toRawUTF8(),roomLabel.getNumBytesAsUTF8()).toHexString());
            value->setProperty("token",juce::String(argv[3]));value->setProperty("source","plugin");
            value->setProperty("connected",true);value->setProperty("music","sending");
            const juce::var body(value);
            ParticipantPresence presence([body]{return body.clone();});presence.activate();
            for(int attempt=0;attempt<100 && !presence.state().available;++attempt)juce::Thread::sleep(50);
            const auto state=presence.state();check(state.available && state.participants.size()==1,"native HTTP presence reaches the real web service");
            const auto& participant=state.participants[0];
            check(participant.id==ParticipantPresence::identity(argv[3]) && participant.browser && participant.music=="sending" && participant.mic,
                "native and browser registrations merge by credential-derived participant ID");
            std::cout<<"PASS: native HTTPS/HTTP client, shared room hash, browser/plugin identity and live roster\n";return 0;
        }
        if(argc==3 && std::string(argv[1])=="--snapshot") {
            ShareStreamProcessor preview;
            std::unique_ptr<juce::AudioProcessorEditor> editor(preview.createEditor());
            auto image=editor->createComponentSnapshot(editor->getLocalBounds());
            juce::FileOutputStream output{juce::File(argv[2])};
            check(output.openedOk(),"open editor preview image");
            output.setPosition(0);output.truncate();
            check(juce::PNGImageFormat().writeImageToStream(image,output),"write editor preview image");
            return 0;
        }
        monitorMeter();
        monitorControls();
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
