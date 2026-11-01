#include "AccountStore.h"
#include "Protocol.h"
#include <filesystem>
#include <chrono>
#if !JUCE_WINDOWS
 #include <cerrno>
 #include <fcntl.h>
 #include <sys/file.h>
 #include <sys/stat.h>
 #include <unistd.h>
#endif

namespace sharestream {
namespace {
// A stable sidecar inode survives atomic replacement of accounts.json. flock
// also serializes independent opens by different plug-in instances/threads in
// one DAW; process-owned fcntl locks do not provide that guarantee.
class AccountWriteLock final {
public:
    explicit AccountWriteLock(const juce::File& target) {
#if JUCE_WINDOWS
        juce::ignoreUnused(target);
        if(!lock.enter(3000))throw juce::String("Account storage is busy. Try again.");
#else
        const auto path=target.getSiblingFile(target.getFileName()+".lock");
        handle=::open(path.getFullPathName().toRawUTF8(),O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600);
        if(handle<0)throw juce::String("Could not open the account storage lock.");
        struct stat info {};
        if(::fstat(handle,&info)!=0 || !S_ISREG(info.st_mode) || info.st_uid!=::geteuid() || ::fchmod(handle,0600)!=0) {
            close();throw juce::String("Could not protect the account storage lock.");
        }
        const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(3);
        while(::flock(handle,LOCK_EX|LOCK_NB)!=0) {
            const auto error=errno;
            if(error!=EWOULDBLOCK && error!=EAGAIN && error!=EINTR) {
                close();throw juce::String("Could not lock account storage.");
            }
            if(std::chrono::steady_clock::now()>=deadline) {
                close();throw juce::String("Account storage is busy. Try again.");
            }
            juce::Thread::sleep(5);
        }
#endif
    }
    ~AccountWriteLock() {
#if JUCE_WINDOWS
        lock.exit();
#else
        close();
#endif
    }
    AccountWriteLock(const AccountWriteLock&)=delete;
    AccountWriteLock& operator=(const AccountWriteLock&)=delete;
private:
#if JUCE_WINDOWS
    juce::InterProcessLock lock {"audio.sharestream.accounts"};
#else
    void close() {if(handle>=0){::close(handle);handle=-1;}}
    int handle=-1;
#endif
};
}
bool AccountStore::enabled() {
    return juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_PRESENCE_URL",{})!="disabled"
        || juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_ACCOUNT_FILE",{}).isNotEmpty();
}
juce::File AccountStore::file() {
    const auto override=juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_ACCOUNT_FILE",{});
    return override.isNotEmpty()?juce::File(override):juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Share Stream/accounts.json");
}
juce::var AccountStore::read() {
    const auto target=file();
    if(enabled() && target.existsAsFile() && target.getSize()>262144)throw juce::String("Account storage is too large.");
    auto value=enabled()?juce::JSON::parse(target):juce::var();
    if(enabled() && target.existsAsFile() && (!value.isObject() || !value["accounts"].isArray()))throw juce::String("Account storage is damaged. Restore it before saving changes.");
    if(!value.isObject())value=juce::var(new juce::DynamicObject);
    if(!value["accounts"].isArray())value.getDynamicObject()->setProperty("accounts",juce::Array<juce::var>());
    return value;
}
juce::var AccountStore::update(const std::function<void(juce::DynamicObject&)>& edit) {
    if(!enabled())return read();
    const auto target=file();
    std::error_code error;
    const auto directory=target.getParentDirectory().getFullPathName().toStdString();
    std::filesystem::create_directories(directory,error);
    if(error)throw juce::String("Could not create account storage.");
    std::filesystem::permissions(directory,std::filesystem::perms::owner_all,std::filesystem::perm_options::replace,error);
    if(error)throw juce::String("Could not protect account storage.");
    const AccountWriteLock lock(target);
    auto value=read();edit(*value.getDynamicObject());
    juce::TemporaryFile temporary(target);
    if(!temporary.getFile().replaceWithText(juce::JSON::toString(value,true)))throw juce::String("Could not save accounts.");
    std::filesystem::permissions(temporary.getFile().getFullPathName().toStdString(),std::filesystem::perms::owner_read|std::filesystem::perms::owner_write,std::filesystem::perm_options::replace,error);
    if(error || !temporary.overwriteTargetFileWithTemporary())throw juce::String("Could not save protected accounts.");
    return value;
}
juce::var AccountStore::put(const juce::var& user,const juce::String& token) {
    const auto id=user["id"].toString();
    if(id.length()!=32 || !id.containsOnly("0123456789abcdef") || token.length()!=64 || !token.containsOnly("0123456789abcdef"))
        throw juce::String("Invalid account session.");
    return update([&](juce::DynamicObject& value){
        auto accounts=value.getProperty("accounts").clone();auto* list=accounts.getArray();
        for(int i=list->size();--i>=0;)if((*list)[i]["user"]["id"].toString()==id)list->remove(i);
        auto* entry=new juce::DynamicObject;entry->setProperty("user",user.clone());entry->setProperty("token",token);list->add(juce::var(entry));
        value.setProperty("accounts",accounts);value.setProperty("active",id);
    });
}
juce::var AccountStore::remove(const juce::String& id) {
    return update([&](juce::DynamicObject& value){
        auto accounts=value.getProperty("accounts").clone();auto* list=accounts.getArray();
        for(int i=list->size();--i>=0;)if((*list)[i]["user"]["id"].toString()==id)list->remove(i);
        value.setProperty("accounts",accounts);
        if(value.getProperty("active").toString()==id)value.setProperty("active",juce::String());
    });
}
juce::var AccountStore::select(const juce::String& id) {
    return update([&](juce::DynamicObject& value){
        bool found=id.isEmpty();for(const auto& entry:*value.getProperty("accounts").getArray())if(entry["user"]["id"].toString()==id)found=true;
        if(!found)throw juce::String("This account is no longer signed in.");
        value.setProperty("active",id);
    });
}
juce::var AccountStore::openRoom(const juce::var& room,bool launch) {
    const auto host=room["host"].toString(),participant=room["participant"].toString();
    if(!parseRoom(room["code"].toString().toStdString()) || host.isEmpty() || host.length()>253 || !host.containsOnly("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-")
        || static_cast<int>(room["port"])<1 || static_cast<int>(room["port"])>65535
        || participant.length()!=32 || !participant.containsOnly("0123456789abcdef"))throw juce::String("Invalid room.");
    return update([&](juce::DynamicObject& value){
        if(room.hasProperty("accountId") && room["accountId"].toString()!=value.getProperty("active").toString())throw juce::String("The active account changed. Try again.");
        auto selected=room.clone();selected.getDynamicObject()->setProperty("accountId",value.getProperty("active"));
        value.setProperty("room",selected);
        if(launch){auto command=selected.clone();command.getDynamicObject()->setProperty("id",juce::Uuid().toString());value.setProperty("launch",command);}
    });
}
juce::var AccountStore::summary(const juce::var& value) {
    auto* result=new juce::DynamicObject;juce::Array<juce::var> accounts;
    if(auto* list=value["accounts"].getArray())for(const auto& entry:*list)accounts.add(entry["user"].clone());
    result->setProperty("accounts",accounts);result->setProperty("active",value["active"]);result->setProperty("room",value["room"]);
    return juce::var(result);
}
}
