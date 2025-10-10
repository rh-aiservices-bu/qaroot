import amqp from 'amqplib';

let connection: any = null;
let channel: any = null;

export async function connectAMQ(): Promise<void> {
  try {
    connection = await amqp.connect(process.env.AMQ_URL || 'amqp://localhost:5672');
    channel = await connection.createChannel();

    // Assert queues
    await channel.assertQueue('analyze.questions', { durable: true });

    console.log('✓ Connected to AMQ');
  } catch (error) {
    console.error('AMQ connection error:', error);
    throw error;
  }
}

export async function publishMessage(queue: string, message: unknown): Promise<void> {
  if (!channel) {
    throw new Error('AMQ channel not initialized');
  }

  await channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
    persistent: true,
  });
}

export async function closeAMQ(): Promise<void> {
  if (channel) await channel.close();
  if (connection) await connection.close();
}
