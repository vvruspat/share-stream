#include "PluginProcessor.h"
#include "PluginEditor.h"

ShareStreamProcessor::ShareStreamProcessor()
  : AudioProcessor(BusesProperties().withInput("Input",juce::AudioChannelSet::stereo(),true)
                                   .withOutput("Output",juce::AudioChannelSet::stereo(),true)) {
    config.code=sharestream::newRoomCode();
    if(standalone()) config.role=sharestream::Role::receive;
    listen.store(config.role==sharestream::Role::receive);
}
void ShareStreamProcessor::prepareToPlay(double rate,int block) {
    engine.prepare(rate,block);
    if(connectionRequested.load() && !engine.isRunning()) engine.connect(configuration());
}
// DAWs can release and prepare audio when playback, monitoring, or the device
// changes. Retain the user's Connect intent; explicit Disconnect/state restore
// still stops it, and the next prepare re-establishes the same room.
void ShareStreamProcessor::releaseResources() { engine.disconnect(); }
bool ShareStreamProcessor::isBusesLayoutSupported(const BusesLayout& layout) const {
    auto in=layout.getMainInputChannelSet(),out=layout.getMainOutputChannelSet();
    return (out==juce::AudioChannelSet::mono() || out==juce::AudioChannelSet::stereo()) &&
           (in==out || in.isDisabled() || (in==juce::AudioChannelSet::mono() && out==juce::AudioChannelSet::stereo()));
}
void ShareStreamProcessor::processBlock(juce::AudioBuffer<float>& audio,juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    midi.clear();
    if(listen.load()) {
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
}
sharestream::Connection ShareStreamProcessor::configuration() const { std::lock_guard lock(configMutex); return config; }
void ShareStreamProcessor::setConfiguration(const sharestream::Connection& value) {
    std::lock_guard lock(configMutex); config=value; listen.store(config.role==sharestream::Role::receive);
}
bool ShareStreamProcessor::start() { const bool connected=engine.connect(configuration()); connectionRequested.store(connected); return connected; }
void ShareStreamProcessor::stop() { connectionRequested.store(false); engine.disconnect(); }
sharestream::Statistics ShareStreamProcessor::statistics() const {
    auto stats=engine.statistics();
    stats.waitingForAudio=connectionRequested.load() && !stats.running;
    stats.running=stats.running || stats.waitingForAudio;
    return stats;
}
juce::AudioProcessorEditor* ShareStreamProcessor::createEditor() { return new ShareStreamEditor(*this); }
void ShareStreamProcessor::getStateInformation(juce::MemoryBlock& data) {
    const auto c=configuration();
    juce::XmlElement state("ShareStream");
    state.setAttribute("version",1); state.setAttribute("server",c.host); state.setAttribute("port",c.port);
    state.setAttribute("room",c.code); state.setAttribute("role",static_cast<int>(c.role)); state.setAttribute("jitter",c.jitterMs);
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
    setConfiguration(c);
    // Restoring a DAW session never starts a broadcast without a Connect click.
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new ShareStreamProcessor(); }
