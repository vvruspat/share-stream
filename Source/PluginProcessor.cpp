#include "PluginProcessor.h"
#include "PluginEditor.h"

ShareStreamProcessor::ShareStreamProcessor()
  : AudioProcessor(BusesProperties().withInput("Input",juce::AudioChannelSet::stereo(),true)
                                   .withOutput("Output",juce::AudioChannelSet::stereo(),true)) {
    config.code=sharestream::newRoomCode();
    if(standalone()) config.role=sharestream::Role::receive;
    listen.store(config.role==sharestream::Role::receive);
}
void ShareStreamProcessor::prepareToPlay(double rate,int block) { engine.prepare(rate,block); }
void ShareStreamProcessor::releaseResources() { engine.disconnect(); }
bool ShareStreamProcessor::isBusesLayoutSupported(const BusesLayout& layout) const {
    auto in=layout.getMainInputChannelSet(),out=layout.getMainOutputChannelSet();
    return (in==juce::AudioChannelSet::mono() || in==juce::AudioChannelSet::stereo()) && in==out;
}
void ShareStreamProcessor::processBlock(juce::AudioBuffer<float>& audio,juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    midi.clear();
    if(listen.load()) audio.clear();
    engine.process(audio.getArrayOfWritePointers(),audio.getNumChannels(),audio.getNumSamples());
}
sharestream::Connection ShareStreamProcessor::configuration() const { std::lock_guard lock(configMutex); return config; }
void ShareStreamProcessor::setConfiguration(const sharestream::Connection& value) {
    std::lock_guard lock(configMutex); config=value; listen.store(config.role==sharestream::Role::receive);
}
bool ShareStreamProcessor::start() { return engine.connect(configuration()); }
void ShareStreamProcessor::stop() { engine.disconnect(); }
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
    engine.disconnect();
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
