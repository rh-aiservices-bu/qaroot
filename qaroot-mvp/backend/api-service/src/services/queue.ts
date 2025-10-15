import amqp from 'amqplib';

let connection: any = null;
let channel: any = null;

export async function connectAMQ(): Promise<void> {
  try {
    let amqUrl = process.env.AMQ_URL || 'amqp://localhost:5672';

    // Add credentials if provided separately
    if (process.env.AMQ_USER && process.env.AMQ_PASSWORD) {
      const url = new URL(amqUrl);
      url.username = process.env.AMQ_USER;
      url.password = process.env.AMQ_PASSWORD;
      amqUrl = url.toString();
      console.log(`Connecting to AMQ with credentials at: ${amqUrl.replace(process.env.AMQ_PASSWORD || '', '***')}`);
    } else {
      console.log(`Connecting to AMQ without credentials at: ${amqUrl}`);
    }

    console.log('Attempting amqp.connect...');
    connection = await amqp.connect(amqUrl);
    console.log('✓ AMQP connection established');

    console.log('Creating channel...');
    channel = await connection.createChannel();
    console.log('✓ Channel created');

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
