#include "AudioCodec.h"
#include <opus.h>
#include <algorithm>
#include <bit>
#include <cmath>

namespace sharestream {
struct AudioCodec::Impl {
    OpusEncoder* encoder=nullptr;
    OpusDecoder* decoder=nullptr;
    AudioQuality lastEncoded=AudioQuality::float32;
    Impl() {
        int error=0;
        encoder=opus_encoder_create(networkRate,channels,OPUS_APPLICATION_RESTRICTED_LOWDELAY,&error);
        decoder=opus_decoder_create(networkRate,channels,&error);
        if(encoder) {
            opus_encoder_ctl(encoder,OPUS_SET_BITRATE(320000));
            opus_encoder_ctl(encoder,OPUS_SET_VBR(0));
            opus_encoder_ctl(encoder,OPUS_SET_SIGNAL(OPUS_SIGNAL_MUSIC));
            opus_encoder_ctl(encoder,OPUS_SET_COMPLEXITY(5));
            opus_encoder_ctl(encoder,OPUS_SET_DTX(0));
        }
    }
    ~Impl() {if(encoder)opus_encoder_destroy(encoder);if(decoder)opus_decoder_destroy(decoder);}
};
AudioCodec::AudioCodec():impl(std::make_unique<Impl>()) {}
AudioCodec::~AudioCodec()=default;
bool AudioCodec::valid() const {return impl->encoder && impl->decoder;}
EncodedFrame AudioCodec::encode(AudioQuality quality,const AudioPacket& audio) {
    EncodedFrame frame{quality,{}};
    if(quality==AudioQuality::pcm24) {
        frame.bytes.resize(packetFrames*6);
        for(int i=0;i<packetFrames;++i)for(int ch=0;ch<channels;++ch) {
            const auto input=ch?audio[i].right:audio[i].left;
            const auto sample=std::isfinite(input)?std::clamp(static_cast<double>(input),-1.0,1.0):0.0;
            const auto word=static_cast<uint32_t>(static_cast<int32_t>(std::clamp(std::round(sample*8388608.0),-8388608.0,8388607.0)));
            for(int b=0;b<3;++b)frame.bytes[i*6+ch*3+b]=static_cast<uint8_t>(word>>(b*8));
        }
    } else if(quality==AudioQuality::opus320 && valid()) {
        if(impl->lastEncoded!=quality)opus_encoder_ctl(impl->encoder,OPUS_RESET_STATE);
        std::array<float,packetFrames*channels> samples {};
        for(int i=0;i<packetFrames;++i)for(int ch=0;ch<channels;++ch) {
            const auto input=ch?audio[i].right:audio[i].left;
            samples[i*2+ch]=std::isfinite(input)?std::clamp(input,-1.0f,1.0f):0.0f;
        }
        frame.bytes.resize(1108);
        const auto bytes=opus_encode_float(impl->encoder,samples.data(),packetFrames,frame.bytes.data(),static_cast<opus_int32>(frame.bytes.size()));
        frame.bytes.resize(bytes>0?static_cast<size_t>(bytes):0);
    }
    impl->lastEncoded=quality;
    return frame;
}
bool AudioCodec::validFrame(const EncodedFrame& frame) const {
    if(frame.quality==AudioQuality::pcm24)return frame.bytes.size()==packetFrames*6;
    return frame.quality==AudioQuality::opus320 && valid() && !frame.bytes.empty() && frame.bytes.size()<=1108
        && opus_packet_get_nb_samples(frame.bytes.data(),static_cast<opus_int32>(frame.bytes.size()),networkRate)==packetFrames
        && opus_packet_get_nb_channels(frame.bytes.data())==channels;
}
bool AudioCodec::decode(const EncodedFrame& frame,AudioPacket& audio) {
    if(!validFrame(frame))return false;
    if(frame.quality==AudioQuality::pcm24) {
        for(int i=0;i<packetFrames;++i) {
            float values[2] {};
            for(int ch=0;ch<channels;++ch) {
                uint32_t word=0;
                for(int b=0;b<3;++b)word|=uint32_t(frame.bytes[i*6+ch*3+b])<<(b*8);
                if(word&0x800000)word|=0xff000000;
                values[ch]=static_cast<float>(std::bit_cast<int32_t>(word))/8388608.0f;
            }
            audio[i]={values[0],values[1]};
        }
    } else {
        std::array<float,packetFrames*channels> samples {};
        if(opus_decode_float(impl->decoder,frame.bytes.data(),static_cast<opus_int32>(frame.bytes.size()),samples.data(),packetFrames,0)!=packetFrames)return false;
        for(int i=0;i<packetFrames;++i)audio[i]={std::isfinite(samples[i*2])?std::clamp(samples[i*2],-8.0f,8.0f):0.0f,
            std::isfinite(samples[i*2+1])?std::clamp(samples[i*2+1],-8.0f,8.0f):0.0f};
    }
    return true;
}
void AudioCodec::resetDecoder() {if(impl->decoder)opus_decoder_ctl(impl->decoder,OPUS_RESET_STATE);}
void AudioCodec::conceal() {
    if(impl->decoder) {
        std::array<float,packetFrames*channels> ignored {};
        if(opus_decode_float(impl->decoder,nullptr,0,ignored.data(),packetFrames,0)<0)resetDecoder();
    }
}
}
