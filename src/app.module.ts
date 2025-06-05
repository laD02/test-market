import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { MarketModule } from './market/market.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(),ConfigModule.forRoot({ isGlobal: true }),PrismaModule, MarketModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
