use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Mandate {
    // The unique identifier for the mandate
    pub id: u64,
    // The business that created the mandate
    pub owner: Pubkey,
    // The user that approves the mandate
    pub user: Pubkey,
    // The expiry time of the mandate
    pub expiry_time: i64,
    // The time the mandate was created
    pub created_at: i64,
    // Whether the mandate is active or not
    pub is_active: bool,
    // The type of debit, fixed or variable
    pub debit_type: DebitType,
    // The amount to be debited, if fixed it will be the amount for each debit,
    // if variable it will be the total amount for the lifetime of the mandate
    pub amount: u64,

    pub is_approved: bool,

    pub mint: Pubkey,

    // The token account of the user that will be debited
    pub user_token_account: Pubkey,
    // The token account of the business that will receive the debit
    pub destination_token_account: Pubkey,

    // The frequency of the debit, in seconds
    pub frequency: Frequency,

    pub seed: u64,
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
