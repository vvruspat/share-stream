#pragma once
#include "Protocol.h"
#include <memory>

namespace sharestream {
// Owned by one network worker. No codec allocation or processing in processBlock.
class AudioCodec {
public:
    AudioCodec();
    ~AudioCodec();
    bool valid() const;
    EncodedFrame encode(AudioQuality,const AudioPacket&);
    bool decode(const EncodedFrame&,AudioPacket&);
    bool validFrame(const EncodedFrame&) const;
    void resetDecoder();
    void conceal();
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}
