#include <juce_audio_processors/juce_audio_processors.h>
#include <iostream>
#include <cmath>
int main(int argc,char** argv) {
    if(argc!=2)return 2;
    juce::ScopedJuceInitialiser_GUI gui;
    juce::VST3PluginFormat format;
    juce::OwnedArray<juce::PluginDescription> descriptions;
    format.findAllTypesForFile(descriptions,argv[1]);
    if(descriptions.isEmpty()){std::cerr<<"VST3 factory scan failed\n";return 1;}
    juce::String error;
    auto plugin=format.createInstanceFromDescription(*descriptions[0],48000,128,error);
    if(!plugin || !std::isinf(plugin->getTailLengthSeconds())){std::cerr<<error<<" invalid network source\n";return 1;}
    for(double rate:{44100.,48000.,96000.})for(int block:{64,137,512}) {
        plugin->prepareToPlay(rate,block);
        juce::AudioBuffer<float> audio(2,block);juce::MidiBuffer midi;
        for(int i=0;i<block;++i){audio.setSample(0,i,.125f);audio.setSample(1,i,-.25f);}
        plugin->processBlock(audio,midi);
        for(int i=0;i<block;++i)if(audio.getSample(0,i)!=.125f || audio.getSample(1,i)!=-.25f)return 1;
        plugin->releaseResources();
    }
    juce::MemoryBlock state;plugin->getStateInformation(state);
    if(state.isEmpty())return 1;
    plugin->setStateInformation(state.getData(),static_cast<int>(state.getSize()));
    std::cout<<"PASS: native VST3 factory, infinite tail, state and transparent stereo Send at 9 host configurations\n";
}
