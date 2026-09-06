/**
 * Store policy documents.
 *
 * These are written for how this store actually operates — goods shipped directly by overseas
 * suppliers (AliExpress and others), long transit times, orders that arrive as separate parcels —
 * because a policy that describes a warehouse this business doesn't have is worse than none.
 *
 * They are NOT a copy of AliExpress's policies, for two reasons. Their text is theirs, and more
 * importantly their terms are a marketplace intermediary's, written for a different legal
 * position than a retailer selling in its own name. This store sells directly to its customers,
 * so it carries the consumer-law obligations itself no matter what its suppliers grant it: under
 * Australian Consumer Law the statutory guarantees can't be excluded, restricted or modified by
 * anything written here, and a policy that tried would be both unenforceable and misleading.
 * Where the supplier's own window is shorter than what this store owes its customers, the store
 * absorbs the difference — that gap is a commercial cost, not something to push onto the buyer.
 *
 * Written to be accurate and complete, but not legal advice: have a lawyer review them, and fill
 * in the entity details marked in `TRADING_ENTITY` below, before relying on them commercially.
 */

/** The specifics a lawyer will ask for. Replace before launch — see README. */
export const TRADING_ENTITY = {
  storeName: "Beach Footprints",
  website: "beachfootprint.com.au",
  /** Registered company/sole-trader name and ABN, once confirmed. */
  legalName: null as string | null,
  abn: null as string | null,
  /** Falls back to the support page when no address is configured. */
  postalAddress: null as string | null,
  governingLaw: "Australia",
};

export interface PolicySection {
  heading: string;
  paragraphs?: string[];
  list?: string[];
}

export interface PolicyDocument {
  slug: string;
  title: string;
  summary: string;
  updated: string;
  sections: PolicySection[];
}

const UPDATED = "5 September 2026";

const RETURNS: PolicyDocument = {
  slug: "returns",
  title: "Returns & Refunds",
  summary:
    "How to return something, what it costs, and how long a refund takes — including how returns work for items shipped directly from our suppliers.",
  updated: UPDATED,
  sections: [
    {
      heading: "Your rights come first",
      paragraphs: [
        "Nothing in this policy takes away rights you have under the Australian Consumer Law or the consumer law of your own country. If an item is faulty, unsafe, significantly different from its description, or doesn't do what we said it would, you are entitled to a repair, replacement or refund — and for a major failure, you choose which. Those rights are not limited by the timeframes below, which describe what we offer on top of them.",
      ],
    },
    {
      heading: "Changed your mind",
      paragraphs: [
        "You can return most items within 30 days of delivery for a refund of the purchase price, provided they are unworn, unwashed and in their original condition and packaging, with any tags still attached.",
        "Return postage for a change of mind is at your cost, and the original shipping charge isn't refunded. We recommend a tracked service — until it reaches us, the parcel is your responsibility.",
      ],
    },
    {
      heading: "Faulty, damaged or not as described",
      paragraphs: [
        "Contact us within a reasonable time of noticing the problem and we'll make it right at our cost. Photographs of the item and its packaging help us resolve it quickly, and often mean you don't need to send anything back at all.",
        "Where returning an item would cost more than it's worth — which is common for items shipped from overseas — we will usually refund or replace it without asking you to return it. That is our choice to make, not a right we're giving up: we may still request the item back where it's reasonable to do so.",
      ],
    },
    {
      heading: "Items we can't accept back for change of mind",
      list: [
        "Earrings and other pierced jewellery, for hygiene reasons",
        "Swimwear and underwear where the hygiene seal has been removed",
        "Personal care and cosmetic items that have been opened or used",
        "Items clearly marked as final sale at the time of purchase",
        "Gift cards",
      ],
      paragraphs: [
        "This list applies to change-of-mind returns only. If one of these items is faulty or not as described, your consumer rights still apply in full.",
      ],
    },
    {
      heading: "Cancelling an order",
      paragraphs: [
        "If your order hasn't been dispatched, contact us and we'll cancel it and refund you in full. Because orders are sent to our suppliers for despatch shortly after payment, the window for this can be short — please get in touch as soon as you can.",
      ],
    },
    {
      heading: "If your order hasn't arrived",
      paragraphs: [
        "Delivery estimates are given on the Shipping & Delivery page. If your order hasn't arrived within 15 days of the end of the estimated delivery window, contact us and we'll either replace it or refund you. You don't need to chase the carrier yourself — that's our job.",
      ],
    },
    {
      heading: "How to start a return",
      paragraphs: [
        "Contact us with your order number and, where relevant, a photo of the item. We'll confirm whether the item needs to come back and, if it does, give you the return address before you send anything. Please don't post an item back without hearing from us first — items are shipped from several different suppliers, and the right return address depends on which one sent yours.",
      ],
    },
    {
      heading: "Refunds",
      paragraphs: [
        "Approved refunds are issued to the original payment method. We process them within 2 business days of approving the return; how long the money takes to appear is then up to your bank or card issuer, typically 5 to 10 business days.",
      ],
    },
  ],
};

const SHIPPING: PolicyDocument = {
  slug: "shipping",
  title: "Shipping & Delivery",
  summary: "Dispatch and delivery times, tracking, split deliveries, customs charges, and what happens if a parcel goes missing.",
  updated: UPDATED,
  sections: [
    {
      heading: "How our shipping works",
      paragraphs: [
        "Our items are shipped directly to you by the supplier who makes or stocks them, rather than from a warehouse of our own. This keeps prices down, and it means delivery takes longer than a domestic retailer — most items travel internationally to reach you.",
      ],
    },
    {
      heading: "Dispatch and delivery times",
      paragraphs: [
        "Orders are sent to the supplier for despatch within 1–2 business days of payment clearing. Typical delivery is 10–25 business days after despatch, depending on where you are and which supplier holds the item.",
        "These are estimates, not guarantees. Customs inspections, weather, carrier backlogs and peak periods can all add time, and none of them are within our control. Where an estimate is shown at checkout, treat it as our honest expectation rather than a promise.",
      ],
    },
    {
      heading: "Orders that arrive in more than one parcel",
      paragraphs: [
        "If your order contains items from different suppliers, they ship separately and will usually arrive on different days, each with its own tracking. You are charged shipping once, not per parcel. If part of your order has arrived and the rest hasn't within the estimated window, contact us about the outstanding items rather than the order as a whole.",
      ],
    },
    {
      heading: "Tracking",
      paragraphs: [
        "You'll get a tracking number by email once your order is despatched. International tracking can take several days to start updating, and often goes quiet while a parcel is in transit between countries. A tracking number that hasn't moved in a week is normal; one that hasn't moved in three is worth contacting us about.",
      ],
    },
    {
      heading: "Customs, duties and taxes",
      paragraphs: [
        "Because items are shipped internationally, your country may charge import duties, taxes or handling fees on delivery. These are set by your government, are not included in the price you paid us, and are your responsibility as the importer. We can't tell you in advance what they'll be.",
        "We don't mark parcels as gifts or understate their value. Doing so is customs fraud, and it puts the person receiving the parcel at risk, not us.",
      ],
    },
    {
      heading: "Wrong or incomplete addresses",
      paragraphs: [
        "We ship to the address given at checkout. Please check it carefully — once an order is with the supplier we usually can't change it. If a parcel is returned to sender because the address was wrong or nobody could accept it, we'll re-send it once you cover the reshipping cost, or refund you the item price less the shipping we've already paid.",
      ],
    },
    {
      heading: "Lost parcels",
      paragraphs: [
        "If tracking shows no movement for an extended period, or the estimated delivery window has passed by more than 15 days, contact us. We'll replace the order or refund it. See the Returns & Refunds page for how that works.",
      ],
    },
  ],
};

const TERMS: PolicyDocument = {
  slug: "terms",
  title: "Terms & Conditions",
  summary: "The terms you agree to when you buy from this store.",
  updated: UPDATED,
  sections: [
    {
      heading: "Who you're buying from",
      paragraphs: [
        `These terms apply to your use of ${TRADING_ENTITY.website} and to anything you buy from us. By placing an order you accept them. We sell to you directly — we are the seller, not a marketplace or an agent for someone else — even though the items are shipped to you by our suppliers.`,
      ],
    },
    {
      heading: "Prices and currency",
      paragraphs: [
        "Prices are shown in the currency selected in the store and include that amount only. Shipping is added at checkout, and any import duties or taxes charged on delivery are separate and payable by you — see Shipping & Delivery.",
        "We may change prices at any time, but a change never affects an order we have already accepted.",
      ],
    },
    {
      heading: "Orders and when the contract is formed",
      paragraphs: [
        "Your order is an offer to buy. We accept it when we despatch the items, and the contract between us forms at that point.",
        "Occasionally we may not be able to accept an order — an item sells out, a price or description turns out to be wrong, or we can't verify the payment or delivery address. If that happens we'll tell you and refund anything you've paid in full. A listing being visible on the site isn't a guarantee that stock exists.",
      ],
    },
    {
      heading: "Payment",
      paragraphs: [
        "Payments are processed by Stripe. We never see or store your full card details. Your order is confirmed only once Stripe tells us the payment has succeeded.",
      ],
    },
    {
      heading: "Product descriptions and images",
      paragraphs: [
        "We describe our products as accurately as we can, and much of the information and imagery comes from the suppliers who make them. Colours vary between screens, and handmade or naturally-dyed items vary between pieces. Measurements are approximate unless stated otherwise.",
        "If an item you receive is materially different from how it was described, that's covered by the Returns & Refunds page and by your consumer rights.",
      ],
    },
    {
      heading: "Your consumer rights",
      paragraphs: [
        "Our goods come with guarantees that cannot be excluded under the Australian Consumer Law. Nothing in these terms excludes, restricts or modifies any right or remedy you have under that law or any other law that applies to you and can't be contracted out of.",
        "Where we are legally permitted to limit our liability, and to the extent the law allows, our liability to you for any claim connected with an order is limited to replacing the goods, supplying equivalent goods, or refunding what you paid for them.",
      ],
    },
    {
      heading: "Using this site",
      list: [
        "Don't use the site for anything unlawful, or in a way that interferes with it working for other people",
        "Don't attempt to gain access to accounts, systems or data that aren't yours",
        "Don't scrape, copy or republish our content, imagery or catalogue for commercial use without our permission",
      ],
    },
    {
      heading: "Our content",
      paragraphs: [
        `The design, text, branding and layout of this site belong to ${TRADING_ENTITY.storeName}. Product imagery and descriptions may belong to our suppliers or their licensors. You may use the site for personal, non-commercial purposes.`,
      ],
    },
    {
      heading: "Changes to these terms",
      paragraphs: [
        "We may update these terms. The version that applies to your order is the one published when you placed it, and the date at the top of this page tells you when it last changed.",
      ],
    },
    {
      heading: "Governing law",
      paragraphs: [
        `These terms are governed by the laws of ${TRADING_ENTITY.governingLaw}. This doesn't deprive you of the protection of the consumer laws of the country you live in.`,
      ],
    },
  ],
};

const PRIVACY: PolicyDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  summary: "What personal information we collect, why we hold it, who we share it with, and how to get it corrected or deleted.",
  updated: UPDATED,
  sections: [
    {
      heading: "What we collect",
      list: [
        "Your name, email address, phone number and delivery address, so we can send you what you bought",
        "Your order history and its delivery status",
        "Messages you send us, such as support or return requests",
        "Reviews you submit, including the name you post them under",
        "Basic technical information your browser sends, such as your device type and pages visited",
      ],
      paragraphs: [
        "We do not collect or store your card details. Payments go directly to Stripe, who handle them under their own privacy terms.",
      ],
    },
    {
      heading: "Why we hold it",
      paragraphs: [
        "To take and fulfil your order, to keep you updated on its delivery, to handle returns and support requests, to meet our tax and consumer-law record-keeping obligations, and to keep the store working and secure. We don't sell your personal information.",
      ],
    },
    {
      heading: "Who we share it with — including overseas",
      paragraphs: [
        "To get your order to you, we pass your name, delivery address and phone number to the supplier who ships it and to their carrier. Those suppliers are generally located outside your country, most often in China. By placing an order you agree to your delivery details being disclosed overseas for that purpose. We take reasonable steps to share only what's needed to deliver your order.",
        "We also use service providers who process data on our behalf: Stripe for payments, Supabase for our database and file storage, Vercel for hosting, and Resend for order emails, alongside the dropshipping service that places orders with our suppliers.",
      ],
    },
    {
      heading: "Marketing",
      paragraphs: [
        "We'll only send you marketing email if you've opted in, and every one of those emails has an unsubscribe link. Emails about an order you've placed — confirmations, despatch and delivery updates — aren't marketing and are sent regardless.",
      ],
    },
    {
      heading: "How long we keep it",
      paragraphs: [
        "Order and payment records are kept for as long as tax and consumer-law obligations require, which in Australia is generally seven years. Support messages and marketing preferences are kept until they're no longer needed or you ask us to remove them.",
      ],
    },
    {
      heading: "Access, correction and deletion",
      paragraphs: [
        "You can ask us what personal information we hold about you, ask us to correct it, or ask us to delete it. We'll respond within a reasonable time and won't charge you for asking. Where we have to keep something — a completed order record, for example — we'll tell you why.",
      ],
    },
    {
      heading: "Cookies",
      paragraphs: [
        "We use cookies and similar local storage to keep your cart between visits and to remember your preferences. You can clear or block them in your browser, though the cart won't work properly without them.",
      ],
    },
    {
      heading: "Complaints",
      paragraphs: [
        "If you think we've mishandled your personal information, contact us first and we'll try to put it right. If you're not satisfied with our response, you can complain to the Office of the Australian Information Commissioner at oaic.gov.au.",
      ],
    },
  ],
};

export const POLICIES: PolicyDocument[] = [RETURNS, SHIPPING, TERMS, PRIVACY];

export function getPolicy(slug: string): PolicyDocument | undefined {
  return POLICIES.find((p) => p.slug === slug);
}
