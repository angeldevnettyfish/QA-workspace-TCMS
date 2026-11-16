"""In-process SSE subscribers for changes to the shared Scrum board."""
import asyncio


_subscribers = set()


def subscribe():
    queue = asyncio.Queue(maxsize=1)
    _subscribers.add(queue)
    return queue


def unsubscribe(queue):
    _subscribers.discard(queue)


def publish(version):
    for queue in tuple(_subscribers):
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            queue.put_nowait(version)
        except asyncio.QueueFull:
            pass
