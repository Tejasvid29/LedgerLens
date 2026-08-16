import { Module } from '@nestjs/common';
import { ServiceAuthGuard } from './service-auth.guard';
import { UsersService } from './users.service';

@Module({
  providers: [ServiceAuthGuard, UsersService],
  exports: [ServiceAuthGuard, UsersService],
})
export class AuthModule {}
