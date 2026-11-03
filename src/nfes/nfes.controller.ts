import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { isValidAccessKey } from './contracts';
import { Nfe } from './nfe.entity';
import { NfesService } from './nfes.service';

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
}

function requireAccessKey(key: unknown): string {
  if (!isValidAccessKey(key)) {
    throw new BadRequestException('accessKey must have 44 numeric digits');
  }
  return key;
}
