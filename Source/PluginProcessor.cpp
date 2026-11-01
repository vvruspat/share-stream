#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "Invitation.h"
#include "AccountStore.h"

static juce::AudioProcessorValueTreeState::ParameterLayout monitorParameters() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    for(const auto& item:std::array<std::pair<const char*,const char*>,2>{{{"sendMonitorDb","Send monitor"},{"listenMonitorDb","Listen monitor"}}})
        layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID(item.first,1),item.second,
            juce::NormalisableRange<float>(-60.0f,6.0f,0.1f),0.0f,
            juce::AudioParameterFloatAttributes().withLabel("dB")
                .withStringFromValueFunction([](float db,int){return db<=-60?juce::String("Mute"):juce::String(db,1)+" dB";})
                .withValueFromStringFunction([](const juce::String& value){return value.equalsIgnoreCase("Mute")?-60.0f:value.getFloatValue();})));
    return layout;
}
static float monitorLevel(const std::atomic<float>* value) {
    const auto db=value->load();
    // JUCE's normalized parameter round trip can turn the 0 dB default into a
    // few micro-dB. Preserve the original bit-exact Send passthrough at unity.
    if(!std::isfinite(db) || std::abs(db)<0.0001f)return 1.0f;
    return db<=-60.0f ? 0.0f : juce::Decibels::decibelsToGain(db);
}
ShareStreamProcessor::ShareStreamProcessor()
  : AudioProcessor(BusesProperties().withInput("Input",juce::AudioChannelSet::stereo(),true)
                                   .withOutput("Output",juce::AudioChannelSet::stereo(),true)),
    parameters(*this,nullptr,"Monitor",monitorParameters()), presence([this] {
      const auto c=configuration();const auto s=statistics();
      const auto token=participantToken();
      auto* value=new juce::DynamicObject;
      const juce::String roomLabel="ShareStream-call-room-v1:"+juce::String(c.code);
      value->setProperty("room",juce::SHA256(roomLabel.toRawUTF8(),roomLabel.getNumBytesAsUTF8()).toHexString());
      value->setProperty("token",token);if(directory.name().isNotEmpty())value->setProperty("name",directory.name());value->setProperty("source","plugin");value->setProperty("connected",s.running);
      juce::var music;
      if(s.running)music=juce::String(!s.peer || s.waitingForAudio ? "connecting" : c.role==sharestream::Role::send ? "sending" : "listening");
      value->setProperty("music",music);
      return juce::var(value);
    }) {
    config.code=sharestream::newRoomCode();
    sendMonitorValue=parameters.getRawParameterValue("sendMonitorDb");
    listenMonitorValue=parameters.getRawParameterValue("listenMonitorDb");
    if(standalone()) config.role=sharestream::Role::receive;
    listen.store(config.role==sharestream::Role::receive);
    if(sharestream::AccountStore::enabled()) {
        try {
            const auto stored=sharestream::AccountStore::read();
            const auto active=stored["active"].toString();
            const auto last=stored["transports"][juce::Identifier(active.isEmpty()?juce::String("guest"):active)][standalone()?"receiver":"plugin"];
            const auto shared=stored["room"];
            const auto room=shared.isObject() && (shared["accountId"].toString().isEmpty() || shared["accountId"]==stored["active"])?shared:last;
            if(sharestream::parseRoom(room["code"].toString().toStdString())) {
                config.code=room["code"].toString().toStdString();
                if(room["host"].toString().isNotEmpty())config.host=sharestream::canonicalRelayHost(room["host"].toString().toStdString());
                config.port=juce::jlimit(1,65535,static_cast<int>(room["port"]));
                if(!standalone())config.role=static_cast<int>(last["role"])==2?sharestream::Role::receive:sharestream::Role::send;
                config.jitterMs=juce::jlimit(5,100,last.hasProperty("jitter")?static_cast<int>(last["jitter"]):40);
                const int quality=last["quality"];if(sharestream::validQuality(quality))config.quality=static_cast<sharestream::AudioQuality>(quality);
                connectionRequested.store(static_cast<bool>(last["connected"]));
                listen.store(config.role==sharestream::Role::receive);
                for(const auto* id:{"sendMonitorDb","listenMonitorDb"})if(last.hasProperty(id)) {
                    auto* parameter=parameters.getParameter(id);parameter->setValueNotifyingHost(parameter->convertTo0to1(juce::jlimit(-60.0f,6.0f,static_cast<float>(last[id]))));
                }
            }
        } catch(const juce::String&) { /* Account UI can report a damaged store without stopping DAW construction. */ }
        startTimer(500);
    }
}
ShareStreamProcessor::~ShareStreamProcessor() {stopTimer();saveSession();}
void ShareStreamProcessor::prepareToPlay(double rate,int block) {
    prepared.store(true);
    meterSampleRate.store(rate);
    monitorGain.reset(rate,0.02);
    monitorGain.setCurrentAndTargetValue(monitorLevel(listen.load()?listenMonitorValue:sendMonitorValue));
    engine.prepare(rate,block);
    if(connectionRequested.load() && !engine.isRunning()) {engine.connect(configuration());presence.activate();}
}
// DAWs can release and prepare audio when playback, monitoring, or the device
// changes. Retain the user's Connect intent; explicit Disconnect/state restore
// still stops it, and the next prepare re-establishes the same room.
void ShareStreamProcessor::releaseResources() { prepared.store(false);engine.disconnect(); meterTime.store(0); }
bool ShareStreamProcessor::isBusesLayoutSupported(const BusesLayout& layout) const {
    auto in=layout.getMainInputChannelSet(),out=layout.getMainOutputChannelSet();
    return (out==juce::AudioChannelSet::mono() || out==juce::AudioChannelSet::stereo()) &&
           (in==out || in.isDisabled() || (in==juce::AudioChannelSet::mono() && out==juce::AudioChannelSet::stereo()));
}
void ShareStreamProcessor::processBlock(juce::AudioBuffer<float>& audio,juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    midi.clear();
    const bool listening=listen.load();
    if(listening) {
        audio.clear();
        engine.process(audio.getArrayOfWritePointers(),juce::jmin(audio.getNumChannels(),getTotalNumOutputChannels()),audio.getNumSamples());
    } else {
        const auto inputs=getTotalNumInputChannels(), outputs=juce::jmin(audio.getNumChannels(),getTotalNumOutputChannels());
        for(int ch=inputs;ch<outputs;++ch) {
            if(inputs>0) audio.copyFrom(ch,0,audio,0,0,audio.getNumSamples());
            else audio.clear(ch,0,audio.getNumSamples());
        }
        engine.process(audio.getArrayOfWritePointers(),outputs,audio.getNumSamples());
    }
    // Capture/send always happens before local monitoring gain. Turning down
    // Send monitoring must never turn down the partner's stream.
    monitorGain.setTargetValue(monitorLevel(listening?listenMonitorValue:sendMonitorValue));
    for(int i=0;i<audio.getNumSamples();++i) {
        const float gain=monitorGain.getNextValue();
        for(int ch=0;ch<audio.getNumChannels();++ch)audio.getWritePointer(ch)[i]*=gain;
    }
    // Meter the actual local output, after smoothing and monitoring gain. Audio
    // capture for the remote peer has already happened above this point.
    for(int ch=0;ch<2;++ch)monitorPeak[ch].store(audio.getNumSamples()>0 && audio.getNumChannels()>0
        ? audio.getMagnitude(juce::jmin(ch,audio.getNumChannels()-1),0,audio.getNumSamples()) : 0,std::memory_order_relaxed);
    meterTime.store(juce::Time::getMillisecondCounterHiRes()*1000,std::memory_order_release);
}
sharestream::Connection ShareStreamProcessor::configuration() const { std::lock_guard lock(configMutex); return config; }
void ShareStreamProcessor::setConfiguration(const sharestream::Connection& value) {
    auto normalized=value;normalized.host=sharestream::canonicalRelayHost(normalized.host);
    bool reconnect=false, roomChanged=false;
    { std::lock_guard lock(configMutex);reconnect=connectionRequested.load() && config.role!=value.role;roomChanged=config.code!=normalized.code || config.host!=normalized.host || config.port!=normalized.port; }
    if(roomChanged)directory.cancelBrowserHandoff();
    if(reconnect)engine.disconnect();
    { std::lock_guard lock(configMutex);config=normalized;listen.store(config.role==sharestream::Role::receive); }
    if(reconnect && prepared.load())connectionRequested.store(engine.connect(normalized));
    else engine.setQuality(value.quality);
    if(!restoring)saveSession(roomChanged);
}
bool ShareStreamProcessor::start() { const bool connected=engine.connect(configuration()); connectionRequested.store(connected); if(connected)presence.activate();saveSession(true);return connected; }
void ShareStreamProcessor::stop() { connectionRequested.store(false); engine.disconnect();if(!restoring)saveSession(); }
void ShareStreamProcessor::saveSession(bool selectRoom) {
    if(!sharestream::AccountStore::enabled() || restoring)return;
    try {
        const auto c=configuration();if(!sharestream::parseRoom(c.code))return;
        auto* session=new juce::DynamicObject;
        session->setProperty("code",juce::String(c.code));session->setProperty("host",juce::String(c.host));session->setProperty("port",c.port);
        session->setProperty("role",static_cast<int>(c.role));session->setProperty("jitter",c.jitterMs);session->setProperty("quality",static_cast<int>(c.quality));
        session->setProperty("connected",connectionRequested.load());session->setProperty("participant",participantToken());
        for(const auto* id:{"sendMonitorDb","listenMonitorDb"})session->setProperty(id,parameters.getRawParameterValue(id)->load());
        const juce::var value(session);
        sharestream::AccountStore::update([&](juce::DynamicObject& store){
            if(!selectRoom && store.getProperty("room").isObject() && store.getProperty("room")["code"].toString()!=juce::String(c.code))return;
            auto transports=store.getProperty("transports").clone();if(!transports.isObject())transports=juce::var(new juce::DynamicObject);
            const auto active=store.getProperty("active").toString();const auto key=active.isEmpty()?juce::String("guest"):active;
            auto own=transports[juce::Identifier(key)].clone();if(!own.isObject())own=juce::var(new juce::DynamicObject);
            own.getDynamicObject()->setProperty(standalone()?"receiver":"plugin",value);transports.getDynamicObject()->setProperty(key,own);store.setProperty("transports",transports);
            if(selectRoom) {auto room=value.clone();room.getDynamicObject()->setProperty("accountId",store.getProperty("active"));store.setProperty("room",room);}
        });
    } catch(const juce::String&) { /* Never fail an audio lifecycle callback because preferences could not be saved. */ }
}
void ShareStreamProcessor::timerCallback() {
    const auto state=directory.state();const auto room=state.sharedRoom;
    if(room["accountId"].toString().isNotEmpty() && room["accountId"]!=state.user["id"])return;
    if(!room.isObject() || !sharestream::parseRoom(room["code"].toString().toStdString()))return;
    auto c=configuration();
    if(c.code==room["code"].toString().toStdString() && c.host==room["host"].toString().toStdString() && c.port==static_cast<int>(room["port"]))return;
    const bool resume=connectionRequested.load();engine.disconnect();
    restoring=true;c.code=room["code"].toString().toStdString();c.host=room["host"].toString().toStdString();c.port=static_cast<int>(room["port"]);setConfiguration(c);restoring=false;
    if(resume)start();else saveSession();
}
bool ShareStreamProcessor::openChat(const juce::String& panel) {
    const auto c=configuration();if(!sharestream::parseRoom(c.code))return false;
    try {
        auto* room=new juce::DynamicObject;
        room->setProperty("code",juce::String(c.code));room->setProperty("host",juce::String(c.host));room->setProperty("port",c.port);
        room->setProperty("participant",participantToken());room->setProperty("panel",panel);
        sharestream::AccountStore::openRoom(juce::var(room),true);
    } catch(const juce::String&) {return false;}
    const auto override=juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_CHAT_APP",{});
    const std::array<juce::File,4> candidates {{override.isNotEmpty()?juce::File(override):juce::File(),
        juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("Applications/Share Stream Chat.app"),
        juce::File("/Applications/Share Stream Chat.app"),
        juce::File::getSpecialLocation(juce::File::currentApplicationFile).getSiblingFile("Share Stream Chat.app")}};
    for(const auto& candidate:candidates)if(candidate.exists() && candidate.startAsProcess())return true;
    return false;
}
sharestream::Statistics ShareStreamProcessor::statistics() const {
    auto stats=engine.statistics();
    stats.waitingForAudio=connectionRequested.load() && !stats.running;
    stats.running=stats.running || stats.waitingForAudio;
    return stats;
}
std::array<float,2> ShareStreamProcessor::monitorPeaks() const {
    const auto last=meterTime.load(std::memory_order_acquire);
    if(!last || juce::Time::getMillisecondCounterHiRes()*1000-last>250000)return {0,0};
    return {monitorPeak[0].load(std::memory_order_relaxed),monitorPeak[1].load(std::memory_order_relaxed)};
}
juce::String ShareStreamProcessor::participantId() const { return sharestream::ParticipantPresence::identity(participantToken()); }

juce::String ShareStreamProcessor::participantToken() const {
    const auto code=configuration().code;const auto saved=directory.participant(code);
    if(saved.isNotEmpty())return saved;
    const auto state=directory.state();const auto shared=state.sharedRoom;
    const auto token=shared["participant"].toString();
    if(shared["code"].toString()==juce::String(code) && token.length()==32 && token.containsOnly("0123456789abcdef")
        && (shared["accountId"].toString().isEmpty() || shared["accountId"]==state.user["id"]))return token;
    return sharestream::ParticipantPresence::localToken(code);
}
sharestream::ParticipantPresence::State ShareStreamProcessor::participants() const {
    auto result=presence.state();
    const juce::String label="ShareStream-call-room-v1:"+juce::String(configuration().code);
    if(result.room!=juce::SHA256(label.toRawUTF8(),label.getNumBytesAsUTF8()).toHexString())return {};
    return result;
}
juce::URL ShareStreamProcessor::collaborationURL() {
    const auto c=configuration();
    const auto invite=sharestream::invitationLink({c.code,sharestream::RelayAddress{c.host,c.port}});
    if(invite.empty())return {};
    presence.activate();
    // The invitation is already encoded. Parsing it as a JUCE URL would escape
    // the entire fragment on launch, including the '=' and '&' separators.
    return juce::URL::createWithoutParsing(juce::String(invite)+"&participant="+participantToken());
}

juce::URL ShareStreamProcessor::browserHandoffURL() const {
    const auto state=directory.state();
    if(state.browserTicket.isEmpty() || state.browserCode!=juce::String(configuration().code)
        || state.browserAccount!=state.user["id"].toString()
        || juce::Time::getMillisecondCounterHiRes()>=state.browserExpiresAt)return {};
    return juce::URL::createWithoutParsing("https://stream.whitesquirrel.digital/connect#handoff="+state.browserTicket);
}
juce::AudioProcessorEditor* ShareStreamProcessor::createEditor() { return new ShareStreamEditor(*this); }
void ShareStreamProcessor::getStateInformation(juce::MemoryBlock& data) {
    const auto c=configuration();
    juce::XmlElement state("ShareStream");
    state.setAttribute("version",1); state.setAttribute("server",c.host); state.setAttribute("port",c.port);
    state.setAttribute("room",c.code); state.setAttribute("role",static_cast<int>(c.role)); state.setAttribute("jitter",c.jitterMs);
    state.setAttribute("quality",static_cast<int>(c.quality));
    state.setAttribute("connected",connectionRequested.load());
    for(const auto* id:{"sendMonitorDb","listenMonitorDb"})state.setAttribute(id,parameters.getRawParameterValue(id)->load());
    copyXmlToBinary(state,data);
}
void ShareStreamProcessor::setStateInformation(const void* data,int size) {
    auto state=getXmlFromBinary(data,size);
    if(!state || !state->hasTagName("ShareStream")) return;
    restoring=true;const bool previousIntent=connectionRequested.load();stop();
    auto c=configuration(); c.host=state->getStringAttribute("server",sharestream::defaultRelayHost).toStdString();
    c.port=juce::jlimit(1,65535,state->getIntAttribute("port",sharestream::defaultPort));
    auto code=state->getStringAttribute("room").toStdString();
    if(sharestream::parseRoom(code)) c.code=code;
    c.role=state->getIntAttribute("role",1)==2 ? sharestream::Role::receive : sharestream::Role::send;
    c.jitterMs=juce::jlimit(5,100,state->getIntAttribute("jitter",40));
    const auto quality=state->getIntAttribute("quality",0);
    c.quality=sharestream::validQuality(quality)?static_cast<sharestream::AudioQuality>(quality):sharestream::AudioQuality::float32;
    for(const auto* id:{"sendMonitorDb","listenMonitorDb"}) {
        auto* parameter=parameters.getParameter(id);
        auto db=static_cast<float>(state->getDoubleAttribute(id,0));
        if(!std::isfinite(db))db=0;
        parameter->setValueNotifyingHost(parameter->convertTo0to1(juce::jlimit(-60.0f,6.0f,db)));
    }
    setConfiguration(c);
    connectionRequested.store(state->hasAttribute("connected")?state->getBoolAttribute("connected"):previousIntent);
    restoring=false;
    // The user opted into restoring music/role. Capture in the chat remains off.
    saveSession(true);
    if(connectionRequested.load() && prepared.load()) {engine.connect(configuration());presence.activate();}
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new ShareStreamProcessor(); }
