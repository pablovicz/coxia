"""Entrada de produção: uvicorn escutando IPv4 e IPv6 na mesma porta.

`uvicorn --host ::` não serve: o asyncio cria o socket com IPV6_V6ONLY, e o
healthcheck do Railway (IPv4) não alcança o serviço. A rede privada do Railway
usa IPv6, então o socket precisa ser dual-stack.
"""

import os
import socket

import uvicorn


def dual_stack_socket(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.bind(("::", port))
    sock.set_inheritable(True)
    return sock


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    config = uvicorn.Config(
        "coxia_ai.main:app_factory",
        factory=True,
        proxy_headers=True,
    )
    uvicorn.Server(config).run(sockets=[dual_stack_socket(port)])


if __name__ == "__main__":
    main()
