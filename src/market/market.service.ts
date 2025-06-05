import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MarketIndex, IndexAnalysis } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketGateway } from './market.gateway'; // giả sử gateway nằm cùng thư mục

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly marketGateway: MarketGateway, // inject gateway để emit WS
  ) {}

  // Chuyển đổi symbol sang mã chuẩn của FMP
  private mapSymbol(symbol: string): string {
    switch (symbol) {
      case '^DJI':
        return 'DIA';
      case '^GSPC':
        return 'SPY';
      case '^IXIC':
        return 'QQQ';
      default:
        return symbol;
    }
  }

  // Lấy dữ liệu chỉ số từ FMP
  async fetchIndexData(symbol: string): Promise<any> {
    const apiKey = this.configService.get<string>('FMP_API_KEY');
    const fmpSymbol = this.mapSymbol(symbol);
    const url = `https://financialmodelingprep.com/api/v3/quote/${fmpSymbol}?apikey=${apiKey}`;

    const res = await axios.get(url);
    const data = res.data?.[0];

    if (!data) throw new Error(`No data found for ${symbol}`);

    return {
      name: symbol === '^DJI' ? 'Dow Jones' : symbol === '^GSPC' ? 'S&P 500' : 'Nasdaq',
      symbol,
      current: data.price,
      open: data.open,
      high: data.dayHigh,
      low: data.dayLow,
      percent: data.changesPercentage,
      updatedAt: new Date(), // FMP không trả timestamp chuẩn
    };
  }

  // Lưu dữ liệu chỉ số vào MongoDB
  async saveMarketData(data: any): Promise<MarketIndex> {
    return this.prisma.marketIndex.create({
      data: {
        name: data.name,
        symbol: data.symbol,
        current: data.current,
        open: data.open,
        high: data.high,
        low: data.low,
        percent: data.percent,
        updatedAt: data.updatedAt,
      },
    });
  }

  // Tính trung bình các phiên gần nhất
  async calculateMovingAverage(symbol: string, limit = 5): Promise<number | null> {
    const recentData = await this.prisma.marketIndex.findMany({
      where: { symbol },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    if (recentData.length === 0) return null;

    const sum = recentData.reduce((acc, cur) => acc + cur.current, 0);
    return sum / recentData.length;
  }

  // Phân tích, đưa ra khuyến nghị Mua/Bán/Không
  async analyzeAndRecommend(symbol: string): Promise<IndexAnalysis> {
    const latestData = await this.prisma.marketIndex.findFirst({
      where: { symbol },
      orderBy: { updatedAt: 'desc' },
    });

    if (!latestData) throw new Error('No market data found');

    const movingAvg5 = await this.calculateMovingAverage(symbol, 5);
    const movingAvg10 = await this.calculateMovingAverage(symbol, 10);

    let recommendation = 'Hold';
    let percentCompare: number | null = null;

    if (movingAvg5) {
      percentCompare = ((latestData.current - movingAvg5) / movingAvg5) * 100;

      if (percentCompare > 5) recommendation = 'Sell';
      else if (percentCompare < -5) recommendation = 'Buy';
    }

    const analysis = await this.prisma.indexAnalysis.create({
      data: {
        indexSymbol: symbol,
        date: new Date(),
        closePrice: latestData.current,
        movingAvg5,
        movingAvg10,
        percentCompare,
        recommendation,
      },
    });

    return analysis;
  }

  // Lấy dữ liệu và phân tích chỉ số
  async getAnalysisBySymbol(symbol: string) {
    const latestMarketData = await this.prisma.marketIndex.findFirst({
      where: { symbol },
      orderBy: { updatedAt: 'desc' },
    });

    const latestAnalysis = await this.prisma.indexAnalysis.findFirst({
      where: { indexSymbol: symbol },
      orderBy: { date: 'desc' },
    });

    return {
      marketData: latestMarketData,
      analysis: latestAnalysis,
    };
  }

  // Lấy tất cả dữ liệu chỉ số (phiên gần nhất)
  async getAllLatestIndices() {
    const symbols = ['^DJI', '^GSPC', '^IXIC'];

    type MarketAnalysisResult = {
      marketData: MarketIndex | null;
      analysis: IndexAnalysis | null;
    };

    const result: MarketAnalysisResult[] = [];

    for (const symbol of symbols) {
      const data = await this.getAnalysisBySymbol(symbol);
      if (data.marketData) result.push(data);
    }
    return result;
  }

  // Cron job crawl dữ liệu mỗi 5 phút
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    const symbols = ['^DJI', '^GSPC', '^IXIC'];

    for (const symbol of symbols) {
      try {
        const data = await this.fetchIndexData(symbol);
        const savedData = await this.saveMarketData(data);
        const analysis = await this.analyzeAndRecommend(symbol);

        // Gửi realtime qua WebSocket Gateway
        this.marketGateway.sendUpdate({
          marketData: savedData,
          analysis,
        });

        this.logger.log(`Updated data & analysis for ${symbol}`);
      } catch (error) {
        this.logger.error(`Failed to update data for ${symbol}: ${error.message}`, error.stack);
      }
    }
  }
}
