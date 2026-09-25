import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ReviewService } from './review.service';
import { CreateReviewDto } from '../../../review/src/dto/review.dto';

@Controller('reviews')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post()
  @RequirePermission(ModuleName.REVIEW, Action.CREATE)
  createReview(@Body() dto: CreateReviewDto) {
    return this.reviewService.createReview(dto);
  }

  @Get('product/:productId')
  @RequirePermission(ModuleName.REVIEW, Action.READ)
  getReviewsByProduct(@Param('productId') productId: string) {
    return this.reviewService.getReviewsByProduct(productId);
  }
}
