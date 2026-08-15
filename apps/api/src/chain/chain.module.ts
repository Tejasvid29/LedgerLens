import { Module } from '@nestjs/common';
import { AlchemyService } from './alchemy.service';
import { SyncService } from './sync.service';

@Module({
  providers: [AlchemyService, SyncService],
  exports: [AlchemyService, SyncService],
})
export class ChainModule {}
