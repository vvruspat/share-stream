#pragma once
// Native UDP on every platform; no socket work runs on the audio thread.
#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mmsystem.h>
namespace sharestream::net {
using Socket = SOCKET;
using Length = int;
constexpr Socket invalid = INVALID_SOCKET;
struct Runtime {
    WSADATA data {};
    bool okay = WSAStartup(MAKEWORD(2, 2), &data) == 0;
    Runtime() { if (okay) timeBeginPeriod(1); }
    ~Runtime() { if (okay) { timeEndPeriod(1); WSACleanup(); } }
};
inline void nonblocking(Socket fd) { u_long enabled=1; ioctlsocket(fd,FIONBIO,&enabled); }
inline void close(Socket fd) { closesocket(fd); }
inline void wait(Socket fd) {
    // Match JUCE's Winsock backend: select avoids WSAPoll's Windows edge cases.
    fd_set readers;FD_ZERO(&readers);FD_SET(fd,&readers);
    timeval timeout {0,1000};select(0,&readers,nullptr,nullptr,&timeout);
}
inline int send(Socket fd,const void* data,size_t size,const sockaddr_in& to) {
    return sendto(fd,static_cast<const char*>(data),static_cast<int>(size),0,reinterpret_cast<const sockaddr*>(&to),sizeof(to));
}
inline int receive(Socket fd,void* data,size_t size,sockaddr_in& from) {
    int length=sizeof(from);
    return recvfrom(fd,static_cast<char*>(data),static_cast<int>(size),0,reinterpret_cast<sockaddr*>(&from),&length);
}
inline void option(Socket fd,int level,int name,const int& value) { setsockopt(fd,level,name,reinterpret_cast<const char*>(&value),sizeof(value)); }
}
#else
#include <arpa/inet.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#include <fcntl.h>
namespace sharestream::net {
using Socket = int;
constexpr Socket invalid = -1;
struct Runtime { bool okay=true; };
inline void nonblocking(Socket fd) { fcntl(fd,F_SETFL,fcntl(fd,F_GETFL,0)|O_NONBLOCK); }
inline void close(Socket fd) { ::close(fd); }
inline void wait(Socket fd) { pollfd p {fd,POLLIN,0}; poll(&p,1,1); }
inline int send(Socket fd,const void* data,size_t size,const sockaddr_in& to) {
    return static_cast<int>(sendto(fd,data,size,0,reinterpret_cast<const sockaddr*>(&to),sizeof(to)));
}
inline int receive(Socket fd,void* data,size_t size,sockaddr_in& from) {
    socklen_t length=sizeof(from);
    return static_cast<int>(recvfrom(fd,data,size,0,reinterpret_cast<sockaddr*>(&from),&length));
}
inline void option(Socket fd,int level,int name,const int& value) { setsockopt(fd,level,name,&value,sizeof(value)); }
}
#endif
