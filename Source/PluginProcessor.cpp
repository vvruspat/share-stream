#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "Invitation.h"

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
      const auto token=sharestream::ParticipantPresence::localToken(c.code);
      auto* value=new juce::DynamicObject;
      const juce::String roomLabel="ShareStream-call-room-v1:"+juce::String(c.code);
      value->setProperty("room",juce::SHA256(roomLabel.toRawUTF8(),roomLabel.getNumBytesAsUTF8()).toHexString());
      value->setProperty("token",token);value->setProperty("source","plugin");value->setProperty("connected",s.running);
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
}
void ShareStreamProcessor::prepareToPlay(double rate,int block) {
    meterSampleRate.store(rate);
    monitorGain.reset(rate,0.02);
    monitorGain.setCurrentAndTargetValue(monitorLevel(listen.load()?listenMonitorValue:sendMonitorValue));
    engine.prepare(rate,block);
    if(connectionRequested.load() && !engine.isRunning()) engine.connect(configuration());
}
// DAWs can release and prepare audio when playback, monitoring, or the device
// changes. Retain the user's Connect intent; explicit Disconnect/state restore
// still stops it, and the next prepare re-establishes the same room.
void ShareStreamProcessor::releaseResources() { engine.disconnect(); meterTime.store(0); }
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
    bool reconnect=false;
    { std::lock_guard lock(configMutex);reconnect=connectionRequested.load() && config.role!=value.role; }
    if(reconnect)engine.disconnect();
    { std::lock_guard lock(configMutex);config=value;listen.store(config.role==sharestream::Role::receive); }
    if(reconnect)connectionRequested.store(engine.connect(value));
    else engine.setQuality(value.quality);
}
bool ShareStreamProcessor::start() { const bool connected=engine.connect(configuration()); connectionRequested.store(connected); if(connected)presence.activate(); return connected; }
void ShareStreamProcessor::stop() { connectionRequested.store(false); engine.disconnect(); }
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
juce::String ShareStreamProcessor::participantId() const { return sharestream::ParticipantPresence::identity(sharestream::ParticipantPresence::localToken(configuration().code)); }
sharestream::ParticipantPresence::State ShareStreamProcessor::participants() const {
    auto result=presence.state();
    const juce::String label="ShareStream-call-room-v1:"+juce::String(configuration().code);
    if(result.room!=juce::SHA256(label.toRawUTF8(),label.getNumBytesAsUTF8()).toHexString())return {};
    return result;
}
juce::String ShareStreamProcessor::collaborationLink() {
    const auto c=configuration();
    const auto invite=sharestream::invitationLink({c.code,sharestream::RelayAddress{c.host,c.port}});
    if(invite.empty())return {};
    presence.activate();
    return juce::String(invite)+"&participant="+sharestream::ParticipantPresence::localToken(c.code);
}
juce::AudioProcessorEditor* ShareStreamProcessor::createEditor() { return new ShareStreamEditor(*this); }
void ShareStreamProcessor::getStateInformation(juce::MemoryBlock& data) {
    const auto c=configuration();
    juce::XmlElement state("ShareStream");
    state.setAttribute("version",1); state.setAttribute("server",c.host); state.setAttribute("port",c.port);
    state.setAttribute("room",c.code); state.setAttribute("role",static_cast<int>(c.role)); state.setAttribute("jitter",c.jitterMs);
    state.setAttribute("quality",static_cast<int>(c.quality));
    for(const auto* id:{"sendMonitorDb","listenMonitorDb"})state.setAttribute(id,parameters.getRawParameterValue(id)->load());
    copyXmlToBinary(state,data);
}
void ShareStreamProcessor::setStateInformation(const void* data,int size) {
    auto state=getXmlFromBinary(data,size);
    if(!state || !state->hasTagName("ShareStream")) return;
    stop();
    auto c=configuration(); c.host=state->getStringAttribute("server","13.140.153.191").toStdString();
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
    // Restoring a DAW session never starts a broadcast without a Connect click.
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new ShareStreamProcessor(); }
