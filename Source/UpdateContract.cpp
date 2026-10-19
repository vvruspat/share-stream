#include "UpdateContract.h"
#include <array>
namespace sharestream::updates {
static std::optional<std::array<int,3>> version(const juce::String& s) {
    auto parts=juce::StringArray::fromTokens(s,".","");
    if(parts.size()!=3)return {};
    std::array<int,3> out {};
    for(int i=0;i<3;++i) {
        if(parts[i].isEmpty() || parts[i].length()>6 || !parts[i].containsOnly("0123456789") || (parts[i].length()>1 && parts[i].startsWithChar('0')))return {};
        out[i]=parts[i].getIntValue();
    }
    return out;
}
bool newer(const juce::String& candidate,const juce::String& installed) {
    auto c=version(candidate),i=version(installed);
    return c && i && *c>*i;
}
std::optional<Release> parseRelease(const juce::var& data,const juce::String& installed,const juce::String& asset) {
    if(!data.isObject() || bool(data["draft"]) || bool(data["prerelease"]))return {};
    const auto tag=data["tag_name"].toString();
    if(!tag.startsWithChar('v') || !newer(tag.substring(1),installed))return {};
    if(auto* assets=data["assets"].getArray())for(const auto& a:*assets) {
        if(a["name"].toString()!=asset)continue;
        const auto expected="https://github.com/vvruspat/share-stream/releases/download/"+tag+"/"+asset;
        const auto digest=a["digest"].toString();
        const auto size=static_cast<juce::int64>(a["size"]);
        if(a["browser_download_url"].toString()!=expected || !digest.startsWith("sha256:") || digest.length()!=71
           || !digest.substring(7).containsOnly("0123456789abcdef") || size<=0 || size>512*1024*1024)return {};
        return Release{tag.substring(1),asset,expected,digest.substring(7),size};
    }
    return {};
}
juce::String platformAsset() {
#if JUCE_MAC
    return "ShareStream-Setup-macOS.zip";
#elif JUCE_WINDOWS
    return "ShareStream-Setup-Windows-x64.exe";
#else
    return juce::File("/etc/fedora-release").existsAsFile() ? "ShareStream-Fedora-x86_64.rpm" : "ShareStream-Ubuntu-amd64.deb";
#endif
}
static juce::Result validateZip(juce::ZipFile& zip) {
    if(zip.getNumEntries()==0 || zip.getNumEntries()>12000)return juce::Result::fail("Invalid installer archive.");
    juce::int64 total=0;
    for(int i=0;i<zip.getNumEntries();++i) {
        const auto* e=zip.getEntry(i);
        const auto path=e->filename.replaceCharacter('\\','/');
        total+=e->uncompressedSize;
        if(e->isSymbolicLink || path.isEmpty() || path.startsWithChar('/') || path.containsChar(':')
           || juce::StringArray::fromTokens(path,"/","").contains("..") || total>1024LL*1024*1024)
            return juce::Result::fail("Unsafe installer archive.");
    }
    return juce::Result::ok();
}
juce::Result extractZip(juce::ZipFile& zip,const juce::File& root) {
    if(auto result=validateZip(zip);result.failed())return result;
    auto result=zip.uncompressTo(root);
    if(result.failed())return result;
    for(int i=0;i<zip.getNumEntries();++i) {
        const auto* e=zip.getEntry(i);
        if((e->externalFileAttributes>>16)&0111)root.getChildFile(e->filename).setExecutePermission(true);
    }
    return result;
}
juce::Result extractArchive(const juce::File& file,const juce::File& root) {
    juce::ZipFile zip(file);
    if(auto result=validateZip(zip);result.failed())return result;
#if JUCE_MAC
    // ditto restores executable bits, AppleDouble metadata and stapled tickets.
    juce::ChildProcess process;
    if(!process.start(juce::StringArray{"/usr/bin/ditto","-x","-k",file.getFullPathName(),root.getFullPathName()})
       || !process.waitForProcessToFinish(60000) || process.getExitCode()!=0)
        return juce::Result::fail("Cannot extract installer. Check disk space.");
    return juce::Result::ok();
#else
    return extractZip(zip,root);
#endif
}
}
