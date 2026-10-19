#include "InstallTransaction.h"
namespace sharestream::updates {
juce::Result install(const std::vector<InstallItem>& items,const juce::File& backup,
                     const std::function<juce::Result(const juce::File&)>& validate) {
    struct Entry {InstallItem item;juce::File staging,old;bool movedOld=false,movedNew=false;};
    std::vector<Entry> entries;
    if(auto r=backup.createDirectory();r.failed())return r;
    const juce::ScopeGuard cleanup([&]{for(auto& e:entries)e.staging.deleteRecursively();});
    for(const auto& item:items) {
        if(!item.source.exists())return juce::Result::fail("Installer payload is incomplete.");
        for(auto parent=item.destination;parent!=parent.getParentDirectory();parent=parent.getParentDirectory())
            if(parent.isSymbolicLink())return juce::Result::fail("Install location contains a symbolic link: "+parent.getFullPathName());
        if(auto r=item.destination.getParentDirectory().createDirectory();r.failed())return r;
        auto staging=item.destination.getSiblingFile(".share-stream-"+juce::Uuid().toString()+"-"+item.destination.getFileName());
        entries.push_back({item,staging,backup.getChildFile(item.destination.getFileName())});
#if JUCE_MAC
        juce::ChildProcess copy;
        if(!copy.start(juce::StringArray{"/usr/bin/ditto",item.source.getFullPathName(),staging.getFullPathName()})
           || !copy.waitForProcessToFinish(60000) || copy.getExitCode()!=0)return juce::Result::fail("Could not stage installation. Check disk space.");
#else
        if(!(item.source.isDirectory()?item.source.copyDirectoryTo(staging):item.source.copyFileTo(staging)))
            return juce::Result::fail("Could not stage installation. Check disk space.");
#endif
        if(auto r=validate(staging);r.failed())return r;
    }
    for(auto& e:entries) {
        // Backups must be on the same volume for rename-only replacement.
        e.old=e.item.destination.getSiblingFile(".share-stream-previous-"+juce::Uuid().toString());
        bool okay=true;
        if(e.item.destination.exists()) {e.movedOld=e.item.destination.moveFileTo(e.old);okay=e.movedOld;}
        if(okay) {e.movedNew=e.staging.moveFileTo(e.item.destination);okay=e.movedNew;}
        if(!okay) {
            juce::String failures;
            for(auto it=entries.rbegin();it!=entries.rend();++it) {
                if(it->movedNew && !it->item.destination.moveFileTo(it->staging))failures+="\n"+it->item.destination.getFullPathName();
                if(it->movedOld && !it->old.moveFileTo(it->item.destination))failures+="\nBackup: "+it->old.getFullPathName();
            }
            return juce::Result::fail("Could not replace files. Close Share Stream and the DAW, then retry."+failures);
        }
    }
    for(auto& e:entries)if(e.movedOld) {
        // Same-volume old bundles remain intact even if moving to backup fails.
        if(!e.old.moveFileTo(backup.getChildFile(e.item.destination.getFileName())))continue;
    }
    return juce::Result::ok();
}
}
