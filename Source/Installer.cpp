#include <juce_gui_extra/juce_gui_extra.h>
#include "InstallTransaction.h"
#include "UpdateContract.h"

namespace {
juce::Result signature(const juce::File& bundle) {
    juce::ChildProcess process;
    // The staging filename is random, so require the expected team here; the
    // embedded payload and the installer itself are also signed and notarized.
    const auto requirement="anchor apple generic and certificate leaf[subject.OU] = \"3WKK5AGY66\"";
    if(!process.start(juce::StringArray{"/usr/bin/codesign","--verify","--deep","--strict","-R",requirement,bundle.getFullPathName()})
       || !process.waitForProcessToFinish(15000) || process.getExitCode()!=0)
        return juce::Result::fail("Apple signature verification failed. Nothing installed.");
    return juce::Result::ok();
}
class Setup final : public juce::Component,private juce::Thread,private juce::Timer {
public:
    explicit Setup(bool update):Thread("Share Stream installer") {
        setSize(580,360);
        title.setText("Share Stream",juce::dontSendNotification);title.setFont(juce::Font(juce::FontOptions(34).withStyle("Bold")));
        details.setText("Install " SHARE_STREAM_VERSION "\n\nStandalone receiver · VST3 · Audio Unit\nFor this user. No administrator password needed.\n\nSave your session. Restart the DAW and standalone after installation.",juce::dontSendNotification);
        details.setColour(juce::Label::textColourId,juce::Colour(0xff91a49a));
        button.setButtonText("Install Share Stream");button.setColour(juce::TextButton::buttonColourId,juce::Colour(0xffb2f5ca));
        button.setColour(juce::TextButton::textColourOffId,juce::Colour(0xff101615));
        button.onClick=[this]{if(done) {app().startAsProcess();juce::JUCEApplication::quit();}else begin();};
        for(auto* c:std::initializer_list<juce::Component*>{&title,&details,&button})addAndMakeVisible(c);
        if(update)juce::Timer::callAfterDelay(300,[safe=juce::Component::SafePointer<Setup>(this)]{if(safe)safe->begin();});
    }
    ~Setup() override {signalThreadShouldExit();waitForThreadToExit(-1);stopTimer();}
    void paint(juce::Graphics& g) override {g.fillAll(juce::Colour(0xff101615));}
    void resized() override {title.setBounds(32,24,516,50);details.setBounds(32,85,516,190);button.setBounds(32,292,516,42);}
private:
    juce::File home=juce::File::getSpecialLocation(juce::File::userHomeDirectory);
    juce::File app() const {return home.getChildFile("Applications/Share Stream.app");}
    void begin() {button.setEnabled(false);button.setButtonText("Installing...");startThread();startTimer(100);}
    void run() override {
        juce::InterProcessLock lock("audio.sharestream.install");
        if(!lock.enter(0)) {result=juce::Result::fail("Another installer is running. Try again shortly.");return;}
        const juce::ScopeGuard unlock([&]{lock.exit();});
        const auto temp=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("share-stream-"+juce::Uuid().toString());
        const juce::ScopeGuard cleanup([&]{temp.deleteRecursively();});
        const auto payload=juce::File::getSpecialLocation(juce::File::currentApplicationFile).getChildFile("Contents/Resources/payload.zip");
        result=sharestream::updates::extractArchive(payload,temp);
        if(result.failed())return;
        const auto backup=home.getChildFile("Library/Application Support/Share Stream/Previous installs/"+juce::Time::getCurrentTime().formatted("%Y%m%d-%H%M%S")+"-"+juce::Uuid().toString());
        result=sharestream::updates::install({
            {temp.getChildFile("Share Stream.vst3"),home.getChildFile("Library/Audio/Plug-Ins/VST3/Share Stream.vst3")},
            {temp.getChildFile("Share Stream.component"),home.getChildFile("Library/Audio/Plug-Ins/Components/Share Stream.component")},
            {temp.getChildFile("Share Stream.app"),app()}},backup,signature);
    }
    void timerCallback() override {
        if(isThreadRunning())return;stopTimer();button.setEnabled(true);
        done=result.wasOk();
        details.setText(done?"Installed " SHARE_STREAM_VERSION ".\n\nThe standalone receiver, VST3 and Audio Unit are ready.\nRestart your DAW and any open standalone window.\nYour room and audio output settings are preserved.":result.getErrorMessage(),juce::dontSendNotification);
        button.setButtonText(done?"Open Share Stream":"Retry installation");
    }
    juce::Label title,details;juce::TextButton button;
    juce::Result result=juce::Result::ok();bool done=false;
};
class Installer final:public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override {return "Share Stream Setup";}
    const juce::String getApplicationVersion() override {return SHARE_STREAM_VERSION;}
    void initialise(const juce::String& args) override {
        window=std::make_unique<Window>();window->setContentOwned(new Setup(args.contains("--update")),true);
        window->centreWithSize(580,360);window->setVisible(true);
    }
    void shutdown() override {window.reset();}
private:
    class Window final:public juce::DocumentWindow {
    public:
        Window():DocumentWindow("Share Stream Setup",juce::Colour(0xff101615),DocumentWindow::closeButton){setUsingNativeTitleBar(true);}
        void closeButtonPressed() override {juce::JUCEApplication::quit();}
    };
    std::unique_ptr<Window> window;
};
}
START_JUCE_APPLICATION(Installer)
