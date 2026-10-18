#pragma once
#include "Protocol.h"
#include <algorithm>
#include <atomic>

namespace sharestream {
// Single producer and single consumer. Only the owner advances its cursor.
template<size_t Capacity = 32768> class AudioRing {
public:
    size_t available() const noexcept { return write.load(std::memory_order_acquire) - read.load(std::memory_order_acquire); }
    bool push(const Stereo* samples, size_t count) noexcept {
        const auto w = write.load(std::memory_order_relaxed);
        if (count > Capacity - (w - read.load(std::memory_order_acquire))) return false;
        for (size_t i=0; i<count; ++i) data[(w+i)%Capacity] = samples[i];
        write.store(w+count, std::memory_order_release); return true;
    }
    size_t peek(float* left, float* right, size_t maxCount) const noexcept {
        const auto r = read.load(std::memory_order_relaxed);
        const auto n = std::min(maxCount, write.load(std::memory_order_acquire)-r);
        for(size_t i=0; i<n; ++i) { left[i]=data[(r+i)%Capacity].left; right[i]=data[(r+i)%Capacity].right; }
        return n;
    }
    void discard(size_t count) noexcept {
        const auto r = read.load(std::memory_order_relaxed);
        read.store(r+std::min(count, write.load(std::memory_order_acquire)-r), std::memory_order_release);
    }
private:
    std::array<Stereo, Capacity> data {};
    alignas(64) std::atomic<size_t> write {0};
    alignas(64) std::atomic<size_t> read {0};
};
}
