import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderClient, SimulatedProviderClient } from '../provider/provider.client';
import { QueueModule } from '../queue/queue.module';
import { Nfe } from './nfe.entity';
import { NfesConsumers } from './nfes.consumers';
import { NfesService } from './nfes.service';
import { NfesController } from './nfes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Nfe]), QueueModule],
  controllers: [NfesController],
  providers: [
    NfesService,
    NfesConsumers,
    { provide: ProviderClient, useClass: SimulatedProviderClient },
  ],
})
export class NfesModule {}
