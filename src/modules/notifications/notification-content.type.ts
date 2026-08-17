/** The "what to say" half of a notification — produced by a domain template
 * (`templates/*.templates.ts`), never written inline in a business service. */
export interface NotificationContent {
  type: string;
  title: string;
  description: string;
  link?: string;
}
