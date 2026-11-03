import {
  BadRequestException,
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
import { EnrichmentResult, isValidAccessKey } from './contracts';
import { Nfe } from './nfe.entity';
import { NfesService } from './nfes.service';
import { WebhookTokenGuard } from './webhook-token.guard';

@Controller()
export class NfesController {
  constructor(private readonly nfes: NfesService) {}

  @Post('nfes')
  async create(
    @Body() body: { accessKey?: unknown } | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Nfe> {
    const { nfe, created } = await this.nfes.create(requireAccessKey(body?.accessKey));
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
  async receiveResult(@Body() body?: Partial<EnrichmentResult>): Promise<void> {
    requireAccessKey(body?.accessKey);
    await this.nfes.receiveResult(body as EnrichmentResult);
  }
}

function requireAccessKey(key: unknown): string {
  if (!isValidAccessKey(key)) {
    throw new BadRequestException('accessKey must have 44 numeric digits');
  }
  return key;
}
