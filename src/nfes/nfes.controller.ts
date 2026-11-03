import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Nfe } from './nfe.entity';
import { CreateNfeDto, EnrichmentResultDto } from './nfes.dto';
import { NfesService } from './nfes.service';
import { WebhookTokenGuard } from './webhook-token.guard';

@Controller()
export class NfesController {
  constructor(private readonly nfes: NfesService) {}

  @Post('nfes')
  async create(@Body() body: CreateNfeDto, @Res({ passthrough: true }) response: Response): Promise<Nfe> {
    const { nfe, created } = await this.nfes.create(body.accessKey);
    response.status(created ? 201 : 200);
    return nfe;
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
