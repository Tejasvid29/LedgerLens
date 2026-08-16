import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { ChainModule } from '../chain/chain.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ChainModule, AuthModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
