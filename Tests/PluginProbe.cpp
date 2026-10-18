#include <juce_audio_processors/juce_audio_processors.h>
#include <iostream>

static bool verify(juce::AudioPluginInstance& plugin,int blockSize,double rate,bool listen) {
    plugin.setPlayConfigDetails(2,2,rate,blockSize);plugin.prepareToPlay(rate,blockSize);
    juce::AudioBuffer<float> buffer(2,blockSize);juce::MidiBuffer midi;
    for(int iteration=0;iteration<20;++iteration) {
        for(int ch=0;ch<2;++ch)for(int i=0;i<blockSize;++i)buffer.setSample(ch,i,ch==0?0.125f:-0.25f);
        plugin.processBlock(buffer,midi);
        for(int ch=0;ch<2;++ch)for(int i=0;i<blockSize;++i)
            if(buffer.getSample(ch,i)!=(listen?0.0f:(ch==0?0.125f:-0.25f)))return false;
    }
    plugin.releaseResources();return true;
}
int main(int argc,char** argv) {
    if(argc!=2) {std::cerr<<"Usage: plugin_probe /absolute/path/Share Stream.vst3\n";return 2;}
    juce::ScopedJuceInitialiser_GUI gui;
    juce::VST3PluginFormat format;
    juce::OwnedArray<juce::PluginDescription> descriptions;
    format.findAllTypesForFile(descriptions,argv[1]);
    if(descriptions.isEmpty()){std::cerr<<"VST3 scan failed\n";return 1;}
    juce::String error;auto plugin=format.createInstanceFromDescription(*descriptions[0],48000,128,error);
    if(!plugin){std::cerr<<error<<'\n';return 1;}
    for(auto rate:{44100.0,48000.0,96000.0})for(auto block:{64,137,512})
        if(!verify(*plugin,block,rate,false)){std::cerr<<"Send passthrough failed\n";return 1;}
    juce::MemoryBlock state;plugin->getStateInformation(state);
    auto xml=juce::AudioProcessor::getXmlFromBinary(state.getData(),static_cast<int>(state.getSize()));
    if(!xml){std::cerr<<"State export failed\n";return 1;}
    auto* component=xml->getChildByName("IComponent");
    juce::MemoryBlock componentData;
    if(!component || !componentData.fromBase64Encoding(component->getAllSubText()))return 1;
    auto processorState=juce::AudioProcessor::getXmlFromBinary(componentData.getData(),static_cast<int>(componentData.getSize()));
    if(!processorState){std::cerr<<"Component state is not XML\n";return 1;}
    processorState->setAttribute("role",2);juce::AudioProcessor::copyXmlToBinary(*processorState,componentData);
    component->deleteAllChildElements();component->addTextElement(componentData.toBase64Encoding());
    juce::AudioProcessor::copyXmlToBinary(*xml,state);
    plugin->setStateInformation(state.getData(),static_cast<int>(state.getSize()));
    if(!verify(*plugin,128,48000,true)){std::cerr<<"Disconnected Listen must be silent\n";return 1;}
    plugin->getStateInformation(state);
    auto restored=juce::AudioProcessor::getXmlFromBinary(state.getData(),static_cast<int>(state.getSize()));
    component=restored?restored->getChildByName("IComponent"):nullptr;
    if(!component || !componentData.fromBase64Encoding(component->getAllSubText()))return 1;
    processorState=juce::AudioProcessor::getXmlFromBinary(componentData.getData(),static_cast<int>(componentData.getSize()));
    if(!processorState || processorState->getIntAttribute("role")!=2){std::cerr<<"State restore failed\n";return 1;}
    std::cout<<"PASS: VST3 factory, instantiation, 9 audio configurations, transparent Send, silent Listen, state restore\n";
}
