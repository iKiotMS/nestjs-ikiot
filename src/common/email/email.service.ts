import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

interface SubscriptionReminderData {
  tenantName: string;
  planName: string;
  daysLeft: number;
  endDate: Date;
}

// Ported from iKiotMS-BE's src/services/emailService.js — only sendSubscriptionReminder
// for now (that's all Subscription needs). sendSystemNotificationEmail is deferred until
// the system-notification/announcement module is ported for real.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT) || 587,
        secure: process.env.MAIL_PORT === '465',
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
      });
    }
    return this.transporter;
  }

  async sendSubscriptionReminder(
    to: string,
    data: SubscriptionReminderData,
  ): Promise<void> {
    if (!process.env.MAIL_HOST || !process.env.MAIL_USER) {
      this.logger.warn('MAIL_HOST/MAIL_USER not configured, skipping email');
      return;
    }

    const formattedDate = data.endDate.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const subject =
      data.daysLeft === 1
        ? `[iKiot] Gói ${data.planName} của bạn sẽ hết hạn vào NGÀY MAI`
        : `[iKiot] Gói ${data.planName} của bạn sẽ hết hạn sau ${data.daysLeft} ngày`;

    try {
      await this.getTransporter().sendMail({
        from: `"iKiot" <${process.env.MAIL_FROM || process.env.MAIL_USER}>`,
        to,
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Nhắc nhở gia hạn dịch vụ</h2>
            <p>Xin chào <strong>${data.tenantName}</strong>,</p>
            <p>
              Gói dịch vụ <strong>${data.planName}</strong> của bạn sẽ hết hạn vào ngày
              <strong>${formattedDate}</strong>
              ${data.daysLeft === 1 ? '(ngày mai)' : `(còn ${data.daysLeft} ngày)`}.
            </p>
            <p>Vui lòng đăng nhập vào hệ thống và gia hạn để tiếp tục sử dụng đầy đủ tính năng mà không bị gián đoạn.</p>
            <p style="color: #666; font-size: 13px;">Nếu bạn đã gia hạn, vui lòng bỏ qua email này.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px;">Trân trọng,<br/>Đội ngũ iKiot</p>
          </div>
        `,
      });
    } catch (error) {
      // Same invariant as NotificationService.notify — a reminder email failing must
      // never break the cron run for the other tenants it's processing.
      this.logger.error(
        `Failed to send subscription reminder to ${to}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
