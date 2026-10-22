#include "RoomDirectory.h"
#include <filesystem>

namespace sharestream {
namespace {
juce::File accountFile() {
    const auto override=juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_ACCOUNT_FILE",{});
    return override.isNotEmpty()?juce::File(override):juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Share Stream/accounts.json");
}
}
RoomDirectory::RoomDirectory() : Thread("Share Stream rooms") {
    if(juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_PRESENCE_URL",{})=="disabled")return;
    startThread();
}
RoomDirectory::~RoomDirectory() { signalThreadShouldExit();notify();stopThread(-1); }
RoomDirectory::State RoomDirectory::state() const { std::lock_guard lock(mutex);return current; }
juce::String RoomDirectory::participant(const juce::String& code) const {
    std::lock_guard lock(mutex);
    if(auto* rooms=current.rooms.getArray())for(const auto& room:*rooms)if(room["code"].toString()==code)return room["participant"].toString();
    return {};
}
juce::String RoomDirectory::name() const { std::lock_guard lock(mutex);return current.user["name"].toString(); }
void RoomDirectory::request(juce::String path, juce::var body, juce::String method) {
    { std::lock_guard lock(mutex);if(current.busy)return;current.busy=true;current.error={};current.notice={};tasks.push_back({path,method,body,-1}); }
    notify();
}
void RoomDirectory::select(int index) {
    { std::lock_guard lock(mutex);if(current.busy)return;current.busy=true;tasks.push_back({{},{},{},index}); }
    notify();
}
juce::var RoomDirectory::perform(const Task& task, const juce::String& credential) {
    const auto base=juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_DIRECTORY_URL","https://stream.whitesquirrel.digital");
    auto url=juce::URL(base+task.path);
    if(task.method!="GET")url=url.withPOSTData(juce::JSON::toString(task.body.isVoid()?juce::var(new juce::DynamicObject):task.body,true));
    int status=0;
    const auto headers="Content-Type: application/json\r\n"+(credential.isNotEmpty()?"Authorization: Bearer "+credential+"\r\n":juce::String());
    auto input=url.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inPostData)
        .withHttpRequestCmd(task.method).withExtraHeaders(headers).withConnectionTimeoutMs(3000).withStatusCode(&status).withNumRedirectsToFollow(0));
    if(!input)throw juce::String("Room service unavailable. Try again.");
    juce::MemoryBlock bytes;input->readIntoMemoryBlock(bytes,1024*1024);
    auto response=juce::JSON::parse(bytes.toString());
    if(status!=200)throw response["error"].toString().isNotEmpty()?response["error"].toString():juce::String("Room service unavailable. Try again.");
    if(!response.isObject())throw juce::String("Invalid room service response.");
    return response;
}
void RoomDirectory::save() {
    juce::InterProcessLock lock("audio.sharestream.accounts");
    if(!lock.enter(1000))throw juce::String("Could not save accounts. Try again.");
    struct Unlock { juce::InterProcessLock& lock; ~Unlock(){lock.exit();} } unlock{lock};
    const auto file=accountFile();
    if(file.getParentDirectory().createDirectory().failed())throw juce::String("Could not create account storage.");
    // Merge accounts added by another plug-in instance without losing them.
    auto previous=juce::JSON::parse(file);
    auto merged=accounts.clone();
    if(auto* list=previous["accounts"].getArray())for(const auto& item:*list) {
        bool found=false;for(const auto& mine:*merged.getArray())if(mine["user"]["id"]==item["user"]["id"])found=true;
        if(!found && item["user"]["id"].toString()!=removedAccount)merged.getArray()->add(item);
    }
    accounts=merged;
    auto* value=new juce::DynamicObject;value->setProperty("accounts",accounts);value->setProperty("active",active);
    std::error_code error;
    std::filesystem::permissions(file.getParentDirectory().getFullPathName().toStdString(),std::filesystem::perms::owner_all,std::filesystem::perm_options::replace,error);
    if(error || !file.replaceWithText(juce::JSON::toString(juce::var(value),true)))throw juce::String("Could not save accounts.");
    std::filesystem::permissions(file.getFullPathName().toStdString(),std::filesystem::perms::owner_read|std::filesystem::perms::owner_write,std::filesystem::perm_options::replace,error);
    if(error)throw juce::String("Could not protect saved account credentials.");
    removedAccount={};
}
void RoomDirectory::run() {
    auto stored=juce::JSON::parse(accountFile());
    if(stored["accounts"].isArray())accounts=stored["accounts"].clone();
    active=stored["active"].toString();
    auto activate=[&] {
        token={};juce::var user;
        if(auto* list=accounts.getArray())for(const auto& item:*list)if(item["user"]["id"].toString()==active){token=item["token"].toString();user=item["user"];}
        std::lock_guard lock(mutex);current.accounts=accounts.clone();current.user=user;current.rooms=juce::var();current.selected=juce::var();current.error={};
    };
    activate();
    while(!threadShouldExit()) {
        Task task;bool hasTask=false;
        { std::lock_guard lock(mutex);if(!tasks.empty()){task=tasks.front();tasks.pop_front();hasTask=true;} }
        try {
            if(hasTask && task.accountIndex>=0) {
                active={};if(auto* list=accounts.getArray())if(task.accountIndex>0 && task.accountIndex<=list->size())active=(*list)[task.accountIndex-1]["user"]["id"].toString();
                activate();save();
            } else if(hasTask) {
                juce::var response;
                try { response=perform(task,token); }
                catch(const juce::String&) { if(task.path!="/api/accounts/logout")throw; }
                if(response["token"].toString().isNotEmpty()) {
                    active=response["user"]["id"].toString();token=response["token"].toString();
                    auto next=accounts.clone();auto* list=next.getArray();
                    for(int i=list->size();--i>=0;)if((*list)[i]["user"]["id"].toString()==active)list->remove(i);
                    auto* item=new juce::DynamicObject;item->setProperty("user",response["user"]);item->setProperty("token",token);list->add(juce::var(item));accounts=next;activate();save();
                } else if(task.path=="/api/accounts/logout") {
                    auto next=accounts.clone();auto* list=next.getArray();removedAccount=active;
                    for(int i=list->size();--i>=0;)if((*list)[i]["user"]["id"].toString()==active)list->remove(i);
                    accounts=next;active={};activate();save();
                }
                if(response["selected"].toString().isNotEmpty()) {
                    if(auto* list=response["rooms"].getArray())for(const auto& room:*list)if(room["id"]==response["selected"]){std::lock_guard lock(mutex);current.selected=room;++current.selection;}
                }
                { std::lock_guard lock(mutex);current.notice=task.path.endsWith("/invitations")?"Room added to that user's list.":""; }
            }
            if(token.isNotEmpty()) {
                const auto response=perform({"/api/rooms","GET",{},-1},token);
                std::lock_guard lock(mutex);current.rooms=response["rooms"];current.user=response["user"];current.accounts=accounts.clone();current.error={};
            }
        } catch(const juce::String& error) { std::lock_guard lock(mutex);current.error=error; }
        { std::lock_guard lock(mutex);current.busy=false; }
        if(!threadShouldExit())wait(5000);
    }
}
}
