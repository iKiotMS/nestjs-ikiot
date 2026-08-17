import { IsIn, IsOptional, IsString } from 'class-validator';

export class FirebaseLoginDto {
  @IsString()
  idToken: string;

  /** "mobile" gates to STAFF accounts only; anything else (default) is the web
   * dashboard, which allows every account kind except CUSTOMER. */
  @IsOptional()
  @IsIn(['mobile', 'web'])
  platform?: 'mobile' | 'web';
}
