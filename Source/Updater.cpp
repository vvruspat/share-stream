#include "Updater.h"
namespace sharestream {
static constexpr auto endpoint="https://api.github.com/repos/vvruspat/share-stream/releases/latest";
static std::unique_ptr<juce::InputStream> open(const juce::String& url,int& status) {
    return juce::URL(url).createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
        .withConnectionTimeoutMs(8000).withNumRedirectsToFollow(5).withStatusCode(&status)
        .withExtraHeaders("Accept: application/vnd.github+json\r\nUser-Agent: ShareStream/" SHARE_STREAM_VERSION "\r\n"));
}
juce::File Updater::settingsFile() const {
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Share Stream/updates.json");
}
Updater::Updater():Thread("Share Stream updates") {
    const auto settings=juce::JSON::parse(settingsFile());
    current.automatic=!settings.hasProperty("automatic") || bool(settings["automatic"]);
    const auto last=static_cast<juce::int64>(settings["checked"]);
    nextCheck=std::max(last,juce::Time::currentTimeMillis())+24LL*60*60*1000;
    if(current.automatic && juce::Time::currentTimeMillis()-last>24LL*60*60*1000)check();
}
Updater::~Updater() { signalThreadShouldExit(); waitForThreadToExit(-1); }
Updater::State Updater::state() {
    const juce::ScopedLock lock(mutex);
    if(packageManager && !packageManager->isRunning()) {
        current.text=packageManager->getExitCode()==0?"Updated · restart Share Stream and your DAW":"Installation cancelled or failed. Click to retry.";
        current.busy=false;packageManager.reset();
    }
    if(current.automatic && !current.busy && juce::Time::currentTimeMillis()>=nextCheck)check();
    return current;
}
void Updater::setText(const juce::String& text) {const juce::ScopedLock lock(mutex);current.text=text;}
void Updater::setAutomatic(bool enabled) {
    const juce::ScopedLock lock(mutex);current.automatic=enabled;
    auto settings=juce::JSON::parse(settingsFile());
    if(!settings.isObject())settings=juce::var(new juce::DynamicObject());
    settings.getDynamicObject()->setProperty("automatic",enabled);
    settingsFile().getParentDirectory().createDirectory();settingsFile().replaceWithText(juce::JSON::toString(settings));
}
void Updater::check(bool download) {
    const juce::ScopedLock lock(mutex);
    if(current.busy || isThreadRunning())return;
    nextCheck=juce::Time::currentTimeMillis()+24LL*60*60*1000;
    downloading=download && release.has_value();
    current.busy=true;current.ready=false;current.text=downloading?"Downloading update...":"Checking GitHub Releases...";
    startThread(juce::Thread::Priority::low);
}
void Updater::run() {
    const auto finish=[this] {const juce::ScopedLock lock(mutex);current.busy=false;};
    // Multiple plug-in instances and a standalone may be open at the same time.
    if(!updateLock.enter(0)) {setText("Another Share Stream instance is checking updates");finish();return;}
    const juce::ScopeGuard unlock([this]{updateLock.exit();});
    try {
        int status=0;
        if(!downloading) {
            auto stream=open(endpoint,status);
            if(!stream || status!=200)throw juce::String(status==403 || status==429?"GitHub rate limit. Try again later.":"Update check unavailable. Click to retry.");
            juce::MemoryBlock json;
            stream->readIntoMemoryBlock(json,2*1024*1024);
            const auto data=juce::JSON::parse(json.toString());
            if(!data.isObject() || !data.hasProperty("tag_name"))throw juce::String("Invalid release response. Try again later.");
            auto latest=updates::parseRelease(data,SHARE_STREAM_VERSION,updates::platformAsset());
            const auto candidate=data["tag_name"].toString().substring(1);
            if(updates::newer(candidate,SHARE_STREAM_VERSION) && !latest)throw juce::String("Release installer is not ready for this platform.");
            {
                const juce::ScopedLock lock(mutex);release=latest;current.available=latest.has_value();
                current.text=latest?"Install update "+latest->version:"Up to date · " SHARE_STREAM_VERSION;
                juce::DynamicObject::Ptr obj=new juce::DynamicObject();
                obj->setProperty("automatic",current.automatic);obj->setProperty("checked",juce::Time::currentTimeMillis());
                settingsFile().getParentDirectory().createDirectory();settingsFile().replaceWithText(juce::JSON::toString(juce::var(obj.get())));
            }
        } else {
            updates::Release r;{const juce::ScopedLock lock(mutex);r=*release;}
            auto root=settingsFile().getParentDirectory().getChildFile("Updates/"+r.version);
            if(auto result=root.createDirectory();result.failed())throw result.getErrorMessage();
            auto file=root.getChildFile(r.name),partial=root.getChildFile(r.name+".partial");
            auto stream=open(r.url,status);
            if(!stream || status!=200)throw juce::String("Could not download installer. Click to retry.");
            {
                juce::FileOutputStream output(partial);
                if(!output.openedOk())throw juce::String("Cannot write update cache.");
                output.setPosition(0);output.truncate();
                std::array<char,65536> bytes {};juce::int64 received=0;
                while(!threadShouldExit() && received<r.size) {
                    auto n=stream->read(bytes.data(),static_cast<int>(std::min<juce::int64>(bytes.size(),r.size-received)));
                    if(n<=0)break;
                    if(!output.write(bytes.data(),static_cast<size_t>(n)))throw juce::String("Not enough disk space for update.");
                    received+=n;setText("Downloading update · "+juce::String(100*received/r.size)+"%");
                }
                output.flush();
                if(threadShouldExit() || received!=r.size || output.getStatus().failed())throw juce::String("Download interrupted. Click to retry.");
            }
            if(juce::SHA256(partial).toHexString()!=r.sha256) {partial.deleteFile();throw juce::String("Installer checksum mismatch. Nothing installed.");}
            if(!partial.moveFileTo(file))throw juce::String("Cannot save verified update.");
#if JUCE_MAC
            auto extracted=root.getChildFile("installer-"+juce::Uuid().toString());
            auto result=updates::extractArchive(file,extracted);
            if(result.failed())throw result.getErrorMessage();
            installer=extracted.getChildFile("Share Stream Setup.app");
            juce::ChildProcess verify;
            const auto requirement="anchor apple generic and certificate leaf[subject.OU] = \"3WKK5AGY66\" and identifier \"audio.sharestream.installer\"";
            if(!verify.start(juce::StringArray{"/usr/bin/codesign","--verify","--deep","--strict","-R",requirement,installer.getFullPathName()})
               || !verify.waitForProcessToFinish(15000) || verify.getExitCode()!=0)throw juce::String("Installer Apple signature is invalid. Nothing installed.");
#else
            installer=file;
#endif
            const juce::ScopedLock lock(mutex);current.ready=true;current.text="Update verified. Starting installer...";
        }
    } catch(const juce::String& error) {setText(error);}
      catch(...) {setText("Update failed. Click to retry.");}
    finish();
}
bool Updater::launch() {
    const juce::ScopedLock lock(mutex);
    if(!current.ready)return false;
    current.ready=false;
#if JUCE_MAC
    juce::ChildProcess process;
    const bool started=process.start(juce::StringArray{"/usr/bin/open","-n",installer.getFullPathName(),"--args","--update"});
#elif JUCE_WINDOWS
    const bool started=installer.startAsProcess("/SILENT /NORESTART /NOCLOSEAPPLICATIONS /NORESTARTAPPLICATIONS");
#else
    // Polkit authenticates the owner; the distro package manager owns these
    // files, resolves dependencies and records the new version for uninstall.
    packageManager=std::make_unique<juce::ChildProcess>();
    const bool rpm=installer.hasFileExtension("rpm");
    const bool started=packageManager->start(juce::StringArray{"/usr/bin/pkexec",rpm?"/usr/bin/dnf":"/usr/bin/apt-get","install","-y",installer.getFullPathName()},0);
    current.busy=started;
#endif
    current.text=started?"Installer opened · restart Share Stream and your DAW":"Could not open installer. Click to retry.";
    return started;
}
}
