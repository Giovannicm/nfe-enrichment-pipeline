import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Nfe } from './nfe.entity';
import { CreateNfeDto, EnrichmentResultDto } from './nfes.dto';
import { NfesService } from './nfes.service';
import { WebhookTokenGuard } from './webhook-token.guard';

@Controller()
export class NfesController {
  constructor(private readonly nfes: NfesService) {}

  @Post('nfes')
  create(@Body() body: CreateNfeDto): Promise<Nfe> {
    return this.nfes.create(body.accessKey);
  }

  @Get('nfes/:id')
  async find(@Param('id', ParseUUIDPipe) id: string): Promise<Nfe> {
    const nfe = await this.nfes.find(id);
    if (!nfe) {
      throw new NotFoundException('NFe not found');
    }
    return nfe;
  }

  @Post('webhooks/provider')
  @HttpCode(202)
  @UseGuards(WebhookTokenGuard)
  async receiveResult(@Body() body: EnrichmentResultDto): Promise<void> {
    await this.nfes.receiveResult(body);
  }
}
