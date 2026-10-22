#include "ParticipantPresence.h"
#include "Protocol.h"

namespace sharestream {
ParticipantPresence::ParticipantPresence(ReadSession read) : Thread("Share Stream participants"), readSession(std::move(read)) {}
ParticipantPresence::~ParticipantPresence() { signalThreadShouldExit(); notify(); stopThread(-1); }
void ParticipantPresence::activate() {
    if(juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_PRESENCE_URL",{} )=="disabled")return;
    if(!isThreadRunning())startThread();
    notify();
}
ParticipantPresence::State ParticipantPresence::state() const { std::lock_guard lock(mutex); return current; }
juce::String ParticipantPresence::identity(const juce::String& token) { return juce::SHA256(token.toRawUTF8(),token.getNumBytesAsUTF8()).toHexString().substring(0,32); }
juce::String ParticipantPresence::localToken(const juce::String& room) {
    // A project copied to another computer must not copy a person's identity.
    // All native instances on this installation share one identity per room.
    static const auto device=[] {
        const auto fallback=juce::String(newRoomCode());
        if(juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_PRESENCE_URL",{})=="disabled")return fallback;
        juce::InterProcessLock lock("audio.sharestream.participant");
        if(!lock.enter(1000))return fallback;
        const auto file=juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Share Stream/participant.key");
        auto key=file.loadFileAsString().trim();
        if(key.length()!=32 || !key.containsOnly("0123456789abcdef")) {
            key=fallback;file.getParentDirectory().createDirectory();file.replaceWithText(key);
        }
        lock.exit();return key;
    }();
    const auto label=device+":"+room;
    return juce::SHA256(label.toRawUTF8(),label.getNumBytesAsUTF8()).toHexString().substring(0,32);
}
void ParticipantPresence::run() {
    const auto endpoint=juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_PRESENCE_URL","https://stream.whitesquirrel.digital/api/presence");
    auto post=[&](const juce::var& body)->juce::var {
        int status=0;
        auto input=juce::URL(endpoint).withPOSTData(juce::JSON::toString(body,true)).createInputStream(
            juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inPostData)
              .withHttpRequestCmd("POST").withExtraHeaders("Content-Type: application/json\r\n")
              .withConnectionTimeoutMs(1500).withStatusCode(&status).withNumRedirectsToFollow(0));
        if(!input || status!=200)return {};
        juce::MemoryBlock bytes;
        input->readIntoMemoryBlock(bytes,16384);
        return juce::JSON::parse(bytes.toString());
    };
    juce::var previous;
    while(!threadShouldExit()) {
        auto body=readSession();
        if(!previous.isVoid() && (previous["room"]!=body["room"] || previous["token"]!=body["token"])) {
            previous.getDynamicObject()->setProperty("connected",false);post(previous);
        }
        auto response=post(body);
        State next;
        next.room=body["room"].toString();
        if(auto* list=response["participants"].getArray()) {
            next.available=true;
            for(const auto& item:*list)next.participants.push_back({item["id"].toString(),item["name"].toString(),
                item["music"].toString(),static_cast<bool>(item["browser"]),static_cast<bool>(item["mic"]),static_cast<bool>(item["speaking"])});
        }
        { std::lock_guard lock(mutex);current=std::move(next); }
        previous=body;
        wait(1000);
    }
    if(!previous.isVoid()) { previous.getDynamicObject()->setProperty("connected",false);post(previous); }
}
}
