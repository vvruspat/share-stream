#include "UpdateContract.h"
#include "InstallTransaction.h"
#include <iostream>
#include <stdexcept>
static void check(bool condition,const char* message) {if(!condition)throw std::runtime_error(message);}
int main() {
    using namespace sharestream::updates;
    try {
        check(newer("1.10.0","1.9.9"),"numeric semver comparison");
        for(auto v:{"0.4.0","0.3.9","0.5.0-beta.1","01.0.0","v1.0.0","1.2","1.2.3.4","9999999.0.0"})
            check(!newer(v,"0.4.0"),"invalid, same, old or prerelease not installed");
        auto release=juce::JSON::parse(R"({"tag_name":"v0.5.0","draft":false,"prerelease":false,"assets":[{"name":"setup.zip","size":123,"digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","browser_download_url":"https://github.com/vvruspat/share-stream/releases/download/v0.5.0/setup.zip"}]})");
        check(parseRelease(release,"0.4.0","setup.zip").has_value(),"verified platform asset selection");
        check(!parseRelease(release,"0.4.0","other.zip"),"missing asset rejected");
        auto asset=(*release["assets"].getArray())[0];
        asset.getDynamicObject()->setProperty("browser_download_url","https://evil.test/setup.zip");
        check(!parseRelease(release,"0.4.0","setup.zip"),"foreign download URL rejected");
        asset.getDynamicObject()->setProperty("browser_download_url","https://github.com/vvruspat/share-stream/releases/download/v0.5.0/setup.zip");
        asset.getDynamicObject()->removeProperty("digest");
        check(!parseRelease(release,"0.4.0","setup.zip"),"missing SHA256 rejected");
        auto temp=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("share-stream-test-"+juce::Uuid().toString());
        temp.createDirectory();const juce::ScopeGuard cleanup([&]{temp.deleteRecursively();});
        auto source=temp.getChildFile("source"),destination=temp.getChildFile("destination");
        source.createDirectory();source.getChildFile("data").replaceWithText("new");
        destination.createDirectory();destination.getChildFile("data").replaceWithText("old");
        auto result=install({{source,destination}},temp.getChildFile("backup"),[](const auto&){return juce::Result::fail("bad signature");});
        check(result.failed() && destination.getChildFile("data").loadFileAsString()=="old","failed signature preserves installed version");
        result=install({{source,destination}},temp.getChildFile("backup2"),[](const auto&){return juce::Result::ok();});
        check(result.wasOk() && destination.getChildFile("data").loadFileAsString()=="new","complete staged install");
        check(temp.getChildFile("backup2/destination/data").loadFileAsString()=="old","previous version preserved");
        // Stage failure in the second component must leave the first untouched.
        result=install({{source,destination},{temp.getChildFile("missing"),temp.getChildFile("second")}},temp.getChildFile("backup3"),[](const auto&){return juce::Result::ok();});
        check(result.failed() && destination.getChildFile("data").loadFileAsString()=="new","all components staged before replacement");
        auto second=temp.getChildFile("second");second.createDirectory();second.getChildFile("data").replaceWithText("second-old");
        int validations=0;
        result=install({{source,destination},{source,second}},temp.getChildFile("backup4"),[&](const auto& staged){
            if(++validations==2)staged.deleteRecursively(); // inject a rename failure after staging
            return juce::Result::ok();
        });
        check(result.failed() && destination.getChildFile("data").loadFileAsString()=="new" && second.getChildFile("data").loadFileAsString()=="second-old","later replacement failure rolls every component back");
        for(auto name:{"../escape","/absolute","C:/drive","a/../../escape"}) {
            juce::MemoryOutputStream output;juce::ZipFile::Builder builder;
            builder.addEntry(new juce::MemoryInputStream("x",1,false),0,name,juce::Time::getCurrentTime());builder.writeToStream(output,nullptr);
            juce::MemoryInputStream input(output.getData(),output.getDataSize(),false);juce::ZipFile zip(input);
            check(extractZip(zip,temp.getChildFile("unzip")).failed(),"archive traversal rejected");
        }
        std::cout<<"PASS: release trust, semantic versions, staged installation, signature failure, backups and archive safety\n";
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
