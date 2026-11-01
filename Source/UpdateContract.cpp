#include "UpdateContract.h"
#include <array>
#include <set>
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
// Electron frameworks use only these two internal relative-link shapes. Never
// allow arbitrary archive symlinks or files written through a symlink parent.
static bool frameworkLink(juce::ZipFile& zip,int index,const juce::String& path) {
    const juce::String marker="/Share Stream Chat.app/Contents/Frameworks/";
    const auto full="/"+path;const auto start=full.indexOf(marker);
    if(start<0)return false;
    const auto parts=juce::StringArray::fromTokens(full.substring(start+marker.length()),"/","");
    if(parts.size()<2 || !parts[0].endsWith(".framework"))return false;
    juce::String expected;
    if(parts.size()==3 && parts[1]=="Versions" && parts[2]=="Current")expected="A";
    else if(parts.size()==2 && parts[1]!="Versions")expected="Versions/Current/"+parts[1];
    if(expected.isEmpty() || zip.getEntry(index)->uncompressedSize>1024)return false;
    std::unique_ptr<juce::InputStream> input(zip.createStreamForEntry(index));
    return input && input->readEntireStreamAsString()==expected;
}
static juce::Result validateZip(juce::ZipFile& zip,bool frameworks=false) {
    if(zip.getNumEntries()==0 || zip.getNumEntries()>12000)return juce::Result::fail("Invalid installer archive.");
    juce::int64 total=0;std::set<juce::String> paths;juce::StringArray links;
    for(int i=0;i<zip.getNumEntries();++i) {
        const auto* e=zip.getEntry(i);
        const auto path=e->filename.replaceCharacter('\\','/').trimCharactersAtEnd("/");
        total+=e->uncompressedSize;
        const auto components=juce::StringArray::fromTokens(path,"/","");
        if((e->isSymbolicLink && (!frameworks || !frameworkLink(zip,i,path))) || path.isEmpty() || path.startsWithChar('/') || path.containsChar(':')
           || components.contains("..") || components.contains(".") || !paths.insert(path).second || total>1024LL*1024*1024)
            return juce::Result::fail("Unsafe installer archive.");
        if(e->isSymbolicLink)links.add(path);
    }
    for(const auto& path:paths)for(const auto& link:links)if(path.startsWith(link+"/"))return juce::Result::fail("Installer archive writes through a symbolic link.");
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
#if JUCE_MAC
    if(auto result=validateZip(zip,true);result.failed())return result;
    if(root.isSymbolicLink() || (root.exists() && (!root.isDirectory() || !root.findChildFiles(juce::File::findFilesAndDirectories,false).isEmpty())))return juce::Result::fail("Installer extraction needs an empty directory.");
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
