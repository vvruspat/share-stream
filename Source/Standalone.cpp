#include <juce_audio_utils/juce_audio_utils.h>
#include "PluginProcessor.h"
#include "PluginEditor.h"

// A dedicated output-only receiver. No input device and no microphone permission.
class ReceiverComponent final : public juce::AudioAppComponent {
public:
    ReceiverComponent() {
        juce::PropertiesFile::Options storage;
        storage.applicationName="Share Stream Receiver"; storage.filenameSuffix=".settings";
        storage.osxLibrarySubFolder="Application Support"; storage.storageFormat=juce::PropertiesFile::storeAsXML;
        settings.setStorageParameters(storage);
        if(auto* properties=settings.getUserSettings()) {
            auto state=properties->getValue("state");juce::MemoryBlock data;
            if(data.fromBase64Encoding(state)) processor.setStateInformation(data.getData(),static_cast<int>(data.getSize()));
        }
        auto config=processor.configuration();config.role=sharestream::Role::receive;processor.setConfiguration(config);
        editor=std::make_unique<ShareStreamEditor>(processor);
        editor->onAudioSettings=[this]{showSettings();};
        addAndMakeVisible(*editor);setSize(editor->getWidth(),editor->getHeight());
        auto* properties=settings.getUserSettings();
        auto deviceState=properties ? properties->getXmlValue("output-device") : nullptr;
        // A saved settings document is output-only as well; inputs are never exposed.
        setAudioChannels(0,2,deviceState.get());
    }
    ~ReceiverComponent() override {
        processor.stop();shutdownAudio();
        if(auto* properties=settings.getUserSettings()) {
            juce::MemoryBlock data;processor.getStateInformation(data);properties->setValue("state",data.toBase64Encoding());
            if(auto xml=deviceManager.createStateXml())properties->setValue("output-device",xml.get());
            properties->saveIfNeeded();
        }
    }
    void prepareToPlay(int block,double rate) override {processor.prepareToPlay(rate,block);}
    void releaseResources() override {processor.releaseResources();}
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info) override {
        info.clearActiveBufferRegion();
        std::array<float*,2> outputs {info.buffer->getWritePointer(0,info.startSample),info.buffer->getWritePointer(info.buffer->getNumChannels()>1?1:0,info.startSample)};
        juce::AudioBuffer<float> block(outputs.data(),info.buffer->getNumChannels()>1?2:1,info.numSamples);
        juce::MidiBuffer midi;processor.processBlock(block,midi);
    }
    void resized() override {if(editor)editor->setBounds(getLocalBounds());}
private:
    void showSettings() {
        auto selector=std::make_unique<juce::AudioDeviceSelectorComponent>(deviceManager,0,0,2,2,false,false,true,false);
        selector->setSize(500,360);
        juce::DialogWindow::LaunchOptions options;
        options.content.setOwned(selector.release());options.dialogTitle="Audio output";
        options.dialogBackgroundColour=juce::Colour(0xff1a2421);options.escapeKeyTriggersCloseButton=true;
        options.useNativeTitleBar=true;options.resizable=false;options.componentToCentreAround=this;
        options.launchAsync();
    }
    ShareStreamProcessor processor;
    std::unique_ptr<ShareStreamEditor> editor;
    juce::ApplicationProperties settings;
};

class ReceiverApplication final : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override {return "Share Stream";}
    const juce::String getApplicationVersion() override {return "0.1.0";}
    bool moreThanOneInstanceAllowed() override {return false;}
    void initialise(const juce::String&) override {window=std::make_unique<Window>();}
    void shutdown() override {window.reset();}
    void systemRequestedQuit() override {quit();}
    void anotherInstanceStarted(const juce::String&) override {if(window)window->toFront(true);}
private:
    class Window final : public juce::DocumentWindow {
    public:
        Window():DocumentWindow("Share Stream",juce::Colour(0xff101615),DocumentWindow::allButtons) {
            setUsingNativeTitleBar(true);setContentOwned(new ReceiverComponent(),true);setResizable(false,false);
            centreWithSize(getWidth(),getHeight());setVisible(true);
        }
        void closeButtonPressed() override {juce::JUCEApplication::getInstance()->systemRequestedQuit();}
    };
    std::unique_ptr<Window> window;
};
START_JUCE_APPLICATION(ReceiverApplication)
