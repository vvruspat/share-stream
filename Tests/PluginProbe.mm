#include <juce_audio_processors/juce_audio_processors.h>
#include <iostream>
#include <cmath>
#include <chrono>
#include "StreamEngine.h"
#import <Cocoa/Cocoa.h>

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
#import <Cocoa/Cocoa.h>
// Exercise the embedded plug-in's public accessibility action. The host editor
// wraps a native NSView, so its JUCE child tree does not contain plug-in controls.
static id findButton(id root,NSString* title,int depth=0) {
    if(!root || depth>30)return nil;
    if([root respondsToSelector:@selector(accessibilityTitle)] && [[root accessibilityTitle] isEqualToString:title] && [root respondsToSelector:@selector(accessibilityPerformPress)])return root;
    if([root respondsToSelector:@selector(accessibilityChildren)])for(id child in [root accessibilityChildren])if(id found=findButton(child,title,depth+1))return found;
    return nil;
}
class ProbeWindow final:public juce::DocumentWindow {
public:
    ProbeWindow():DocumentWindow("Share Stream synthetic receiver test",juce::Colours::black,0){setUsingNativeTitleBar(true);}
    void closeButtonPressed() override {}
};
static void pump() {[[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];}
struct ProcessorState {
    juce::MemoryBlock state,componentData;
    std::unique_ptr<juce::XmlElement> wrapper,config;
    NSMutableDictionary* properties=nil;
    explicit ProcessorState(juce::AudioPluginInstance& plugin) {
        plugin.getStateInformation(state);
        wrapper=juce::AudioProcessor::getXmlFromBinary(state.getData(),static_cast<int>(state.getSize()));
        if(wrapper) {
            auto* component=wrapper->getChildByName("IComponent");
            if(!component || !componentData.fromBase64Encoding(component->getAllSubText()))return;
        } else {
            auto* data=[NSData dataWithBytes:state.getData() length:state.getSize()];
            properties=[NSPropertyListSerialization propertyListWithData:data options:NSPropertyListMutableContainers format:nil error:nil];
            if(![properties isKindOfClass:[NSMutableDictionary class]])return;
            auto* component=properties[@"jucePluginState"];
            if(![component isKindOfClass:[NSData class]])return;
            componentData=juce::MemoryBlock([component bytes],[component length]);
        }
        config=juce::AudioProcessor::getXmlFromBinary(componentData.getData(),static_cast<int>(componentData.getSize()));
    }
    bool apply(juce::AudioPluginInstance& plugin) {
        if(!config)return false;
        juce::AudioProcessor::copyXmlToBinary(*config,componentData);
        if(wrapper) {
            auto* component=wrapper->getChildByName("IComponent");component->deleteAllChildElements();component->addTextElement(componentData.toBase64Encoding());juce::AudioProcessor::copyXmlToBinary(*wrapper,state);
        } else {
            properties[@"jucePluginState"]=[NSData dataWithBytes:componentData.getData() length:componentData.getSize()];
            auto* data=[NSPropertyListSerialization dataWithPropertyList:properties format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil];
            if(!data)return false;
            state=juce::MemoryBlock([data bytes],[data length]);
        }
        plugin.setStateInformation(state.getData(),static_cast<int>(state.getSize()));return true;
    }
};
static bool network(juce::AudioPluginInstance& plugin,int port) {
    ProcessorState state(plugin);if(!state.config)return false;
    sharestream::Connection c;c.host="127.0.0.1";c.port=port;c.code=sharestream::newRoomCode();c.jitterMs=10;
    auto& config=*state.config;
    config.setAttribute("role",2);config.setAttribute("server",c.host);config.setAttribute("port",port);config.setAttribute("room",c.code);config.setAttribute("jitter",10);
    if(!state.apply(plugin))return false;
    auto layout=plugin.getBusesLayout();layout.inputBuses.set(0,juce::AudioChannelSet::disabled());
    const bool inputDisabled=plugin.setBusesLayout(layout);
    // AU effect hosts can require an enabled input bus even for a source. Its
    // buffer remains entirely silent; VST3 must also support disabling the bus.
    if(!inputDisabled && plugin.getPluginDescription().pluginFormatName!="AudioUnit"){std::cerr<<"Output-only layout rejected\n";return false;}
    plugin.prepareToPlay(48000,128);
    std::unique_ptr<juce::AudioProcessorEditor> editor(plugin.createEditorIfNeeded());
    if(!editor)return false;
    ProbeWindow window;window.setContentNonOwned(editor.get(),true);window.centreWithSize(700,580);window.setVisible(true);pump();
    auto* view=(NSView*)window.getPeer()->getNativeHandle();
    id connect=findButton(view,@"Connect");
    if(!connect){std::cerr<<"Connect accessibility action not found\n";window.clearContentComponent();return false;}
    if(![connect accessibilityPerformPress]) {std::cerr<<"Connect accessibility action rejected\n";window.clearContentComponent();return false;}
    // triggerClick posts a JUCE message. Wait for the public UI state change
    // before suspending the UI loop to simulate audio; a fixed 50 ms races CI.
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);
    while(!findButton(view,@"Disconnect") && std::chrono::steady_clock::now()<deadline)pump();
    if(!findButton(view,@"Disconnect")) {std::cerr<<"Connect action did not reach the processor\n";window.clearContentComponent();return false;}
    sharestream::StreamEngine sender;sender.prepare(48000,128);if(!sender.connect(c))return false;
    juce::AudioBuffer<float> tx(2,128),rx(2,128);juce::MidiBuffer midi;
    int audible=0;const auto start=std::chrono::steady_clock::now();
    for(int i=0;i<1125;++i) {
        std::this_thread::sleep_until(start+std::chrono::microseconds(i*8000/3));
        for(int n=0;n<128;++n){tx.setSample(0,n,0.125f);tx.setSample(1,n,-0.25f);}
        sender.process(tx.getArrayOfWritePointers(),2,128);rx.clear();plugin.processBlock(rx,midi);
        if(i>375 && rx.getMagnitude(0,0,128)>0.05f && rx.getSample(1,127)<-0.1f)++audible;
    }
    sender.disconnect();window.clearContentComponent();editor.reset();plugin.releaseResources();
    if(audible<600){std::cerr<<"Plug-in received too few audible blocks: "<<audible<<"\n";return false;}
    std::cout<<"PASS: actual "<<plugin.getPluginDescription().pluginFormatName<<" Listen with "<<(inputDisabled?"disabled":"silent")<<" input, encrypted UDP and stereo output ("<<audible<<" blocks)\n";return true;
}
static int run(int argc,char** argv) {
    if(argc!=2 && argc!=4) {std::cerr<<"Usage: plugin_probe /absolute/path/Share Stream.vst3\n";return 2;}
    juce::ScopedJuceInitialiser_GUI gui;
    std::unique_ptr<juce::AudioPluginFormat> format;
    if(juce::String(argv[1]).endsWithIgnoreCase(".component"))format=std::make_unique<juce::AudioUnitPluginFormat>();
    else format=std::make_unique<juce::VST3PluginFormat>();
    juce::OwnedArray<juce::PluginDescription> descriptions;
    format->findAllTypesForFile(descriptions,argv[1]);
    if(descriptions.isEmpty()){std::cerr<<"VST3 scan failed\n";return 1;}
    juce::String error;auto plugin=format->createInstanceFromDescription(*descriptions[0],48000,128,error);
    if(!plugin){std::cerr<<error<<'\n';return 1;}
    if(!std::isinf(plugin->getTailLengthSeconds())){std::cerr<<"Network source must advertise an infinite tail\n";return 1;}
    for(auto rate:{44100.0,48000.0,96000.0})for(auto block:{64,137,512})
        if(!verify(*plugin,block,rate,false)){std::cerr<<"Send passthrough failed\n";return 1;}
    ProcessorState state(*plugin);
    if(!state.config){std::cerr<<"Processor state export failed\n";return 1;}
    state.config->setAttribute("role",2);
    if(!state.apply(*plugin))return 1;
    if(!verify(*plugin,128,48000,true)){std::cerr<<"Disconnected Listen must be silent\n";return 1;}
    ProcessorState restored(*plugin);
    if(!restored.config || restored.config->getIntAttribute("role")!=2){std::cerr<<"State restore failed\n";return 1;}
    if(argc==4 && !network(*plugin,std::stoi(argv[3])))return 1;
    std::cout<<"PASS: plugin factory, instantiation, 9 audio configurations, transparent Send, silent Listen, state restore\n";
    return 0;
}

int main(int argc,char** argv) {@autoreleasepool{return run(argc,argv);}}
