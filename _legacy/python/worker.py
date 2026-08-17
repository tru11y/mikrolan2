"""
Minimal worker loop. Execute-one driven.

Worker is dumb: calls JobExecutor.execute_one(worker_id) and sleeps.
All logic (selection, locking, retries) lives in JobExecutor.
"""

import asyncio
import logging
import signal
import os
from typing import Optional

from job_executor import JobExecutor

logger = logging.getLogger(__name__)


class Worker:
    """Minimal worker: call executor, sleep, handle shutdown."""

    def __init__(self, executor: JobExecutor, worker_id: str, poll_interval: float = 1.0):
        self.executor = executor
        self.worker_id = worker_id
        self.poll_interval = poll_interval
        self.running = False

    async def run(self) -> None:
        """Main loop: call execute_one, sleep until shutdown."""
        self.running = True
        logger.info(f"Worker {self.worker_id} started")

        while self.running:
            try:
                await self.executor.execute_one(self.worker_id)
                await asyncio.sleep(self.poll_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in worker loop: {e}")
                await asyncio.sleep(self.poll_interval)

    async def shutdown(self) -> None:
        """Stop the worker."""
        self.running = False
        logger.info(f"Worker {self.worker_id} shut down")


async def main() -> None:
    """Entry point."""
    logging.basicConfig(level=logging.INFO)

    worker_id = os.getenv("WORKER_ID", f"worker-{os.getpid()}")
    poll_interval = float(os.getenv("POLL_INTERVAL", "1.0"))

    executor = JobExecutor()
    worker = Worker(executor, worker_id, poll_interval)

    def handle_signal(signum, frame):
        asyncio.create_task(worker.shutdown())

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        await worker.run()
    finally:
        await worker.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
