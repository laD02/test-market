import { Controller, Get, Param } from '@nestjs/common';
import { MarketService } from './market.service';

@Controller('indices')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get()
  async getAllIndices() {
    return this.marketService.getAllLatestIndices();
  }

  @Get(':symbol')
  async getIndexBySymbol(@Param('symbol') symbol: string) {
    return this.marketService.getAnalysisBySymbol(symbol);
  }
}
