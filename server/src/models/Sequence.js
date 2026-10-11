import mongoose from 'mongoose';

const sequenceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  value: {
    type: Number,
    default: 1000,
  },
});

const Sequence = mongoose.model('Sequence', sequenceSchema);

export async function getNextSequence(name = 'incidentNumber') {
  const seq = await Sequence.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );
  return seq.value;
}

export default Sequence;
