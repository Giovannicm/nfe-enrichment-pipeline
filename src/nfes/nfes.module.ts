import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxModule } from '../outbox/outbox.module';
import { ProviderClient, SimulatedProviderClient } from '../provider/provider.client';
import { QueueModule } from '../queue/queue.module';
import { Nfe } from './nfe.entity';
import { NfesConsumers } from './nfes.consumers';
import { NfesService } from './nfes.service';
import { NfesController } from './nfes.controller';
import { WebhookTokenGuard } from './webhook-token.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Nfe]), OutboxModule, QueueModule],
  controllers: [NfesController],
  providers: [
    NfesService,
    NfesConsumers,
    WebhookTokenGuard,
    { provide: ProviderClient, useClass: SimulatedProviderClient },
  ],
})
export class NfesModule {}
