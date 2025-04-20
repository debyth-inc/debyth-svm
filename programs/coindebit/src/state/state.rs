use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Mandate {
    // The unique identifier for the mandate
    pub id: u64,
    // Coindebit is the authority of the mandate, here we save the Coindebit key that created the mandate
    pub authority: Pubkey,
    // The user that approves the mandate
    pub user: Pubkey,

    // The time the mandate was created
    pub created_at: i64,
    // Whether the mandate is active or not
    pub is_active: bool,
    // The type of debit, fixed or variable
    pub debit_type: DebitType,
    // The amount to be debited, if fixed it will be the amount for each debit,
    // if variable it will be the total amount for the lifetime of the mandate
    pub amount: u64,

    // Whether the mandate is approved or not
    pub is_approved: bool,

    // The time the mandate was approved
    pub approved_at: i64,

    // The start date of the mandate
    pub start_date: i64,
    // The end date of the mandate
    pub end_date: i64,

    // If the mandate is cancelled, this will be the time it was cancelled
    pub cancelled_at: i64,

    pub mint: Pubkey,

    // The token account of the user that will be debited
    pub user_token_account: Pubkey,
    // The token account of the business that will receive the debit
    pub destination_token_account: Pubkey,

    // The frequency of the debit, in seconds
    pub frequency: Frequency,

    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum Frequency {
    Daily,
    Weekly,
    Monthly,
}
impl Frequency {
    pub fn as_str(&self) -> &'static str {
        match self {
            Frequency::Daily => "daily",
            Frequency::Weekly => "weekly",
            Frequency::Monthly => "monthly",
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum DebitType {
    Fixed,
    Variable,
}

impl DebitType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DebitType::Fixed => "fixed",
            DebitType::Variable => "variable",
        }
    }
}
